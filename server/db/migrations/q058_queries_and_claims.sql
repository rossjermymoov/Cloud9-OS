-- 058: Queries and Claims
--
-- Queries: customer or system-raised issues against a parcel
--   (where is it, wrong address, not delivered, SLA breach, etc.)
-- Claims: formal compensation requests (lost, damaged)
--
-- Three trigger sources: customer (email/portal), staff (manual), automated (SLA/status rules)
-- All funnel into the same inbox with the same AI-assisted email workflow.

-- ─────────────────────────────────────────────────────────────────────────────
-- Types
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE query_trigger AS ENUM (
  'customer_email',    -- inbound email from customer
  'customer_portal',   -- raised via customer self-service portal
  'staff',             -- manually raised by Moov staff
  'automated_sla',     -- SLA breach detected by system
  'automated_status'   -- triggered by a specific tracking status (damaged, returned, etc.)
);

CREATE TYPE query_type AS ENUM (
  'whereabouts',       -- where is my parcel
  'not_delivered',     -- parcel shows delivered but customer hasn't received it
  'wrong_address',     -- delivered to wrong address
  'damaged',           -- parcel or contents damaged
  'missing_items',     -- items missing from parcel
  'failed_delivery',   -- courier attempted but didn't leave a card / rebook
  'returned',          -- parcel returned to sender unexpectedly
  'delay',             -- SLA breach / general delay
  'other'              -- catch-all
);

CREATE TYPE query_status AS ENUM (
  'open',              -- just raised, not yet acted on
  'drafting',          -- AI has drafted a courier email, awaiting human approval
  'awaiting_courier',  -- email sent to courier, waiting for reply
  'courier_replied',   -- courier has replied, AI drafting customer response
  'awaiting_customer', -- response sent to customer, awaiting their reply
  'resolved',          -- query closed and resolved
  'escalated'          -- escalated to a formal claim
);

CREATE TYPE claim_type AS ENUM (
  'lost',
  'damaged',
  'short_delivery'     -- items missing
);

CREATE TYPE claim_status AS ENUM (
  'open',
  'submitted_to_courier',
  'under_investigation',
  'approved',
  'rejected',
  'closed'
);

CREATE TYPE email_direction AS ENUM (
  'inbound_customer',
  'outbound_customer',
  'inbound_courier',
  'outbound_courier',
  'internal_note'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Service SLAs
-- Defines expected delivery window per courier service code (in hours)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_slas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_code        VARCHAR(20) NOT NULL,        -- e.g. DPD-12, DPD-11
  courier_code        VARCHAR(20) NOT NULL,        -- e.g. dpd, evri, ups
  description         VARCHAR(100),               -- human label e.g. "Next Day"
  sla_hours           SMALLINT NOT NULL,           -- 24, 48, 72
  -- For international: no-movement window triggers a query instead of SLA
  no_movement_hours   SMALLINT,                    -- NULL = use sla_hours logic
  is_international    BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_code, courier_code)
);

-- Seed known domestic DPD SLAs
INSERT INTO service_slas (service_code, courier_code, description, sla_hours, is_international) VALUES
  ('DPD-12', 'dpd', 'Next Day',            24,  false),
  ('DPD-11', 'dpd', 'Two Day',             48,  false),
  ('DPD-14', 'dpd', 'Next Day 10:30',      24,  false),
  ('DPD-13', 'dpd', 'Next Day 12:00',      24,  false),
  ('DPD-16', 'dpd', 'Saturday',            24,  false),
  ('DPD-17', 'dpd', 'Saturday 12:00',      24,  false),
  ('DPD-18', 'dpd', 'Saturday 10:30',      24,  false),
  ('DPD-01', 'dpd', 'Sunday',              24,  false),
  ('DPD-19', 'dpd', 'Classic Parcel EU',   72,  true),
  ('DPD-60', 'dpd', 'Classic Air',         72,  true)
ON CONFLICT (service_code, courier_code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Queries
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS queries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parcel link (required — every query is about a specific parcel)
  parcel_id           UUID REFERENCES parcels(id) ON DELETE SET NULL,
  consignment_number  VARCHAR(100),               -- denormalised for display even if parcel deleted
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name       VARCHAR(255),               -- denormalised

  -- Courier info (denormalised for email drafting)
  courier_code        VARCHAR(20),
  courier_name        VARCHAR(100),
  service_code        VARCHAR(20),
  service_name        VARCHAR(100),

  -- Query details
  trigger             query_trigger NOT NULL,
  query_type          query_type NOT NULL DEFAULT 'other',
  status              query_status NOT NULL DEFAULT 'open',
  subject             VARCHAR(255),               -- brief human-readable title
  description         TEXT,                       -- original customer message or auto-generated summary

  -- SLA context (populated for automated_sla triggers)
  sla_hours           SMALLINT,
  sla_breach_at       TIMESTAMPTZ,                -- when the SLA was/will be breached
  collection_date     DATE,

  -- Courier communication
  courier_email       VARCHAR(255),               -- which courier email address to send to
  courier_reference   VARCHAR(100),               -- courier's own ticket/investigation ref once raised

  -- Resolution
  resolution_notes    TEXT,
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID REFERENCES staff(id) ON DELETE SET NULL,

  -- Escalation to claim
  claim_id            UUID,                       -- FK added after claims table created

  -- AI confidence on last draft (0.0–1.0)
  ai_confidence       NUMERIC(3,2),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES staff(id) ON DELETE SET NULL  -- NULL = automated/customer
);

CREATE INDEX IF NOT EXISTS idx_queries_parcel     ON queries(parcel_id);
CREATE INDEX IF NOT EXISTS idx_queries_customer   ON queries(customer_id);
CREATE INDEX IF NOT EXISTS idx_queries_status     ON queries(status);
CREATE INDEX IF NOT EXISTS idx_queries_created    ON queries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_queries_consignment ON queries(consignment_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- Query emails
-- Every email in/out for a query is stored here — full thread history
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS query_emails (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id            UUID NOT NULL REFERENCES queries(id) ON DELETE CASCADE,

  direction           email_direction NOT NULL,
  subject             VARCHAR(500),
  body_text           TEXT NOT NULL,
  body_html           TEXT,

  -- Gmail thread tracking
  gmail_message_id    VARCHAR(255),               -- Gmail message ID
  gmail_thread_id     VARCHAR(255),               -- Gmail thread ID for grouping
  in_reply_to         VARCHAR(255),               -- message ID this is replying to

  -- Sender / recipient
  from_address        VARCHAR(255),
  to_address          VARCHAR(255),
  cc_address          VARCHAR(255),

  -- AI draft state
  is_ai_draft         BOOLEAN NOT NULL DEFAULT false,
  ai_draft_approved_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  ai_draft_approved_at TIMESTAMPTZ,
  ai_draft_edited     BOOLEAN DEFAULT false,      -- was the AI draft edited before sending

  sent_at             TIMESTAMPTZ,                -- NULL = draft not yet sent
  received_at         TIMESTAMPTZ,                -- for inbound emails
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_emails_query     ON query_emails(query_id);
CREATE INDEX IF NOT EXISTS idx_query_emails_gmail     ON query_emails(gmail_message_id);
CREATE INDEX IF NOT EXISTS idx_query_emails_thread    ON query_emails(gmail_thread_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Claims
-- Formal compensation requests — escalated from queries or raised directly
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS claims (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id            UUID REFERENCES queries(id) ON DELETE SET NULL,

  -- Parcel / customer (denormalised like queries)
  parcel_id           UUID REFERENCES parcels(id) ON DELETE SET NULL,
  consignment_number  VARCHAR(100),
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name       VARCHAR(255),
  courier_code        VARCHAR(20),
  courier_name        VARCHAR(100),

  claim_type          claim_type NOT NULL,
  status              claim_status NOT NULL DEFAULT 'open',

  -- Values
  declared_value      NUMERIC(10,2),              -- value of goods claimed
  claimed_amount      NUMERIC(10,2),              -- amount being claimed
  approved_amount     NUMERIC(10,2),              -- what courier agreed to pay
  charge_id           UUID,                       -- link to original charge for credit note

  -- Courier claim reference
  courier_claim_ref   VARCHAR(100),

  -- Evidence
  evidence_notes      TEXT,                       -- description of damage, loss circumstances

  -- Resolution
  resolution_notes    TEXT,
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID REFERENCES staff(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_claims_parcel    ON claims(parcel_id);
CREATE INDEX IF NOT EXISTS idx_claims_customer  ON claims(customer_id);
CREATE INDEX IF NOT EXISTS idx_claims_status    ON claims(status);

-- Back-fill FK on queries → claims
ALTER TABLE queries ADD CONSTRAINT fk_queries_claim
  FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Gmail connection
-- Stores OAuth tokens per connected Gmail account
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gmail_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_address       VARCHAR(255) NOT NULL UNIQUE,
  is_test             BOOLEAN NOT NULL DEFAULT false,   -- true = test account
  is_active           BOOLEAN NOT NULL DEFAULT true,
  access_token        TEXT,                             -- encrypted at rest
  refresh_token       TEXT,                             -- encrypted at rest
  token_expiry        TIMESTAMPTZ,
  last_sync_at        TIMESTAMPTZ,
  last_history_id     VARCHAR(100),                     -- Gmail API history ID for incremental sync
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
