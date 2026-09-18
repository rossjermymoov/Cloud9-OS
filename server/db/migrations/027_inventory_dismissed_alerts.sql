-- ============================================================
-- Cloud9 OS — Migration 027: Inventory dismissed alerts
-- Stores dismissed dimensional sanity alerts per SKU/customer so that
-- once a user reviews and dismisses an alert, it is permanently silenced.
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_dismissed_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID,
  helm_customer_id VARCHAR(50),
  sku           VARCHAR(150) NOT NULL,
  alert_type    VARCHAR(80) NOT NULL,
  reason        TEXT,
  dismissed_by  VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_dismissed_sku_alert
  ON inventory_dismissed_alerts (COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), sku, alert_type);

CREATE INDEX IF NOT EXISTS idx_inv_dismissed_cust_sku ON inventory_dismissed_alerts (customer_id, sku);
