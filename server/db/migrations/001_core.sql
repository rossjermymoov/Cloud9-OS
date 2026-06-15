-- ============================================================
-- Cloud9 OS — Migration 001: Core schema
-- Customers + tracking + purchase orders + notifications.
-- Customer model copied from Moov OS (proven); tracking tables
-- match the Moov OS tracking page exactly so it drops straight in.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Shared updated_at trigger fn ────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE customer_tier        AS ENUM ('bronze', 'silver', 'gold', 'enterprise');
CREATE TYPE account_status       AS ENUM ('active', 'on_stop', 'suspended', 'churned');
CREATE TYPE health_score_status  AS ENUM ('green', 'amber', 'red');
CREATE TYPE comm_channel         AS ENUM ('email', 'whatsapp', 'ticket', 'internal_note');
CREATE TYPE comm_direction       AS ENUM ('inbound', 'outbound', 'internal');
CREATE TYPE on_stop_action       AS ENUM ('applied', 'removed');

-- Parcel status — identical to the Moov OS tracking page's STATUS config keys.
CREATE TYPE parcel_status AS ENUM (
  'booked', 'collected', 'at_depot', 'in_transit', 'out_for_delivery',
  'failed_delivery', 'delivered', 'on_hold', 'exception', 'returned',
  'tracking_expired', 'cancelled', 'awaiting_collection', 'damaged',
  'customs_hold', 'unknown'
);

CREATE TYPE po_status            AS ENUM ('open', 'partially_received', 'received', 'cancelled');
CREATE TYPE notification_type    AS ENUM ('purchase_order_created', 'stock_received', 'shipment_created', 'tracking_exception', 'volume_drop', 'system');
CREATE TYPE notification_severity AS ENUM ('green', 'amber', 'red');

-- ============================================================
-- STAFF
-- ============================================================
CREATE TABLE staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   VARCHAR(255) NOT NULL,
  email       VARCHAR(255) UNIQUE NOT NULL,
  role        VARCHAR(100) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CUSTOMERS  (copied from Moov OS Section 1)
-- ============================================================
CREATE TABLE customers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name         VARCHAR(255) NOT NULL,
  account_number        VARCHAR(20) UNIQUE NOT NULL,   -- CLD-00001, auto-generated
  helm_customer_id      VARCHAR(64),                   -- id of this customer in Helm

  address_line_1        VARCHAR(255),
  address_line_2        VARCHAR(255),
  city                  VARCHAR(120),
  county                VARCHAR(120),
  postcode              VARCHAR(12),
  country               VARCHAR(120) NOT NULL DEFAULT 'United Kingdom',
  phone_number          VARCHAR(30),
  primary_email         VARCHAR(255),
  accounts_email        VARCHAR(255),

  company_type          VARCHAR(50),
  company_reg_number    VARCHAR(50),
  vat_number            VARCHAR(50),

  tier                  customer_tier  NOT NULL DEFAULT 'bronze',
  account_status        account_status NOT NULL DEFAULT 'active',

  salesperson_id        UUID REFERENCES staff(id) ON DELETE SET NULL,
  account_manager_id    UUID REFERENCES staff(id) ON DELETE SET NULL,
  onboarding_person_id  UUID REFERENCES staff(id) ON DELETE SET NULL,

  credit_limit          NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_terms_days    SMALLINT NOT NULL DEFAULT 30,
  billing_cycle         VARCHAR(20) NOT NULL DEFAULT 'monthly',
  outstanding_balance   NUMERIC(12,2) NOT NULL DEFAULT 0,

  is_on_stop            BOOLEAN NOT NULL DEFAULT false,
  on_stop_reason        TEXT,
  on_stop_applied_at    TIMESTAMPTZ,

  health_score          health_score_status NOT NULL DEFAULT 'green',
  health_score_summary  TEXT,
  health_score_updated  TIMESTAMPTZ,

  date_onboarded        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE customer_account_seq START 1 INCREMENT 1;

CREATE OR REPLACE FUNCTION set_customer_account_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_number IS NULL OR NEW.account_number = '' THEN
    NEW.account_number := 'CLD-' || LPAD(nextval('customer_account_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_account_number
  BEFORE INSERT ON customers
  FOR EACH ROW EXECUTE FUNCTION set_customer_account_number();

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX idx_customers_status  ON customers(account_status);
CREATE INDEX idx_customers_health  ON customers(health_score);
CREATE INDEX idx_customers_tier    ON customers(tier);
CREATE INDEX idx_customers_helm    ON customers(helm_customer_id);

-- ── Contacts ────────────────────────────────────────────────
CREATE TABLE customer_contacts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  full_name          VARCHAR(255) NOT NULL,
  job_title          VARCHAR(255),
  phone_number       VARCHAR(30),
  email_address      VARCHAR(255) NOT NULL,
  is_main_contact    BOOLEAN NOT NULL DEFAULT false,
  is_finance_contact BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_contacts_updated_at BEFORE UPDATE ON customer_contacts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE UNIQUE INDEX idx_one_main_contact    ON customer_contacts(customer_id) WHERE is_main_contact = true;
CREATE UNIQUE INDEX idx_one_finance_contact ON customer_contacts(customer_id) WHERE is_finance_contact = true;

-- ── Communications ──────────────────────────────────────────
CREATE TABLE customer_communications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel       comm_channel NOT NULL,
  direction     comm_direction NOT NULL,
  subject       VARCHAR(500),
  body          TEXT NOT NULL,
  from_address  VARCHAR(255),
  staff_id      UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_comms_customer ON customer_communications(customer_id, created_at DESC);

-- ── Volume snapshots + drop alerts ─────────────────────────
CREATE TABLE customer_volume_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  parcel_count  INTEGER NOT NULL DEFAULT 0,
  item_count    INTEGER NOT NULL DEFAULT 0,
  revenue       NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, snapshot_date)
);
CREATE INDEX idx_volume_customer_date ON customer_volume_snapshots(customer_id, snapshot_date DESC);

CREATE TABLE customer_volume_alerts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  baseline_daily_avg NUMERIC(8,2) NOT NULL,
  actual_daily_count INTEGER NOT NULL,
  drop_percentage    NUMERIC(5,2) NOT NULL,
  is_dismissed       BOOLEAN NOT NULL DEFAULT false,
  dismissed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── On-stop audit log ───────────────────────────────────────
CREATE TABLE customer_on_stop_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  action       on_stop_action NOT NULL,
  reason       TEXT NOT NULL,
  actioned_by  UUID REFERENCES staff(id) ON DELETE SET NULL,
  actioned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_on_stop_customer ON customer_on_stop_log(customer_id, actioned_at DESC);

-- ============================================================
-- TRACKING  (tables match the Moov OS tracking page exactly)
-- ============================================================
CREATE TABLE shipments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helm_shipment_id      VARCHAR(64),
  customer_id           UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_account      VARCHAR(64),
  courier               VARCHAR(120),
  reference             VARCHAR(255),
  reference_2           VARCHAR(255),
  ship_to_name          VARCHAR(255),
  ship_to_postcode      VARCHAR(20),
  ship_to_country_iso   VARCHAR(8),
  parcel_count          INTEGER DEFAULT 1,
  total_weight_kg       NUMERIC(10,3),
  collection_date       DATE,
  tracking_codes        TEXT[],
  cancelled             BOOLEAN NOT NULL DEFAULT false,
  cancelled_at          TIMESTAMPTZ,
  raw_payload           JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_shipments_helm ON shipments(helm_shipment_id) WHERE helm_shipment_id IS NOT NULL;
CREATE TRIGGER trg_shipments_updated_at BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE parcels (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_number  VARCHAR(120) UNIQUE NOT NULL,
  courier_name        VARCHAR(120),
  courier_code        VARCHAR(60),
  service_name        VARCHAR(160),
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name       VARCHAR(255),
  customer_account    VARCHAR(64),
  recipient_name      VARCHAR(255),
  recipient_postcode  VARCHAR(20),
  recipient_address   TEXT,
  weight_kg           NUMERIC(10,3),
  estimated_delivery  TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  tracking_url        TEXT,
  status              parcel_status NOT NULL DEFAULT 'unknown',
  status_description  VARCHAR(255),
  last_location       VARCHAR(255),
  last_event_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_parcels_status   ON parcels(status);
CREATE INDEX idx_parcels_customer ON parcels(customer_id);
CREATE INDEX idx_parcels_event_at ON parcels(last_event_at DESC);
CREATE TRIGGER trg_parcels_updated_at BEFORE UPDATE ON parcels
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE tracking_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id           UUID NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  consignment_number  VARCHAR(120) NOT NULL,
  event_code          VARCHAR(60),
  status              parcel_status NOT NULL DEFAULT 'unknown',
  description         VARCHAR(255),
  location            VARCHAR(255),
  event_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload         JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (parcel_id, status, event_at)
);
CREATE INDEX idx_events_consignment ON tracking_events(consignment_number, event_at DESC);

-- ============================================================
-- PURCHASE ORDERS  (customer books stock in)
-- ============================================================
CREATE TABLE purchase_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helm_po_id         VARCHAR(64),
  po_number          VARCHAR(80),
  customer_id        UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_account   VARCHAR(64),
  customer_name      VARCHAR(255),
  status             po_status NOT NULL DEFAULT 'open',
  expected_date      DATE,
  total_lines        INTEGER NOT NULL DEFAULT 0,
  total_units        INTEGER NOT NULL DEFAULT 0,
  raw_payload        JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_po_helm ON purchase_orders(helm_po_id) WHERE helm_po_id IS NOT NULL;
CREATE INDEX idx_po_customer ON purchase_orders(customer_id, created_at DESC);
CREATE TRIGGER trg_po_updated_at BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE purchase_order_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id         UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  sku           VARCHAR(120),
  description   VARCHAR(255),
  qty_ordered   INTEGER NOT NULL DEFAULT 0,
  qty_received  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_po_lines_po ON purchase_order_lines(po_id);

-- ============================================================
-- NOTIFICATIONS  (central feed + threaded onto customer record)
-- ============================================================
CREATE TABLE notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          notification_type NOT NULL,
  severity      notification_severity NOT NULL DEFAULT 'green',
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  customer_name VARCHAR(255),
  title         VARCHAR(255) NOT NULL,
  body          TEXT,
  link_url      VARCHAR(255),          -- e.g. /customers/:id or /tracking?...
  source_event  VARCHAR(120),          -- which webhook produced it
  payload       JSONB,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_feed     ON notifications(created_at DESC);
CREATE INDEX idx_notifications_customer ON notifications(customer_id, created_at DESC);
CREATE INDEX idx_notifications_unread   ON notifications(read_at) WHERE read_at IS NULL;

-- ============================================================
-- HELM SYNC LOG  (audit of customer/item pull runs)
-- ============================================================
CREATE TABLE helm_sync_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type    VARCHAR(60) NOT NULL,    -- customers | items | shipments
  status       VARCHAR(20) NOT NULL,    -- ok | error
  records      INTEGER NOT NULL DEFAULT 0,
  detail       TEXT,
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
