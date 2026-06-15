-- ============================================================
-- Cloud9 OS — Migration 003: Orders
-- The orders table is the source of truth for dispatch volume.
-- Webhooks (order-created / order-updated) and the Helm pull sync both
-- upsert here; customer_volume_snapshots are recomputed from it so parcels
-- reflect the REAL per-order parcel count (orders can have many parcels).
-- ============================================================

CREATE TABLE orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helm_order_id     VARCHAR(64),
  channel_order_id  VARCHAR(160),
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  helm_client_id    VARCHAR(64),          -- Helm fulfilment_client id (resolves the customer)
  status_id         INTEGER,
  status_label      VARCHAR(60),
  sale_type         VARCHAR(20),
  item_count        INTEGER NOT NULL DEFAULT 0,   -- units shipped (total_inventory_quantity)
  parcel_count      INTEGER NOT NULL DEFAULT 0,   -- REAL parcel count for this order
  total_weight      NUMERIC(10,3),
  channel_id        INTEGER,
  received_at       TIMESTAMPTZ,
  dispatched_at     TIMESTAMPTZ,                  -- set once the order is despatched
  raw_payload       JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_orders_helm ON orders(helm_order_id) WHERE helm_order_id IS NOT NULL;
CREATE INDEX idx_orders_cust_disp   ON orders(customer_id, dispatched_at);
CREATE INDEX idx_orders_dispatched  ON orders(dispatched_at) WHERE dispatched_at IS NOT NULL;

CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
