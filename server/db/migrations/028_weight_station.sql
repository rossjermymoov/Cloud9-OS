-- ============================================================
-- Cloud9 OS — Migration 028: Weight & Measure Station & Audit Logs
-- ============================================================

-- 1. Add role to app_users if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'role'
  ) THEN
    ALTER TABLE app_users ADD COLUMN role VARCHAR(50) NOT NULL DEFAULT 'admin';
  END IF;
END $$;

-- 2. Create inventory_weight_logs audit table
CREATE TABLE IF NOT EXISTS inventory_weight_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID REFERENCES customers(id) ON DELETE SET NULL,
  helm_customer_id VARCHAR(100),
  customer_name    VARCHAR(255),
  product_id       VARCHAR(100) NOT NULL,
  sku              VARCHAR(255) NOT NULL,
  barcode          VARCHAR(255),
  product_name     TEXT,
  old_weight       NUMERIC(12, 4),
  new_weight       NUMERIC(12, 4) NOT NULL,
  weight_unit      VARCHAR(20) NOT NULL DEFAULT 'g',
  old_length       NUMERIC(12, 4),
  new_length       NUMERIC(12, 4),
  old_width        NUMERIC(12, 4),
  new_width        NUMERIC(12, 4),
  old_height       NUMERIC(12, 4),
  new_height       NUMERIC(12, 4),
  dimension_unit   VARCHAR(20) NOT NULL DEFAULT 'cm',
  user_id          UUID REFERENCES app_users(id) ON DELETE SET NULL,
  user_name        VARCHAR(255),
  user_email       VARCHAR(255),
  status           VARCHAR(50) NOT NULL DEFAULT 'synced',
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weight_logs_sku ON inventory_weight_logs (sku);
CREATE INDEX IF NOT EXISTS idx_weight_logs_barcode ON inventory_weight_logs (barcode);
CREATE INDEX IF NOT EXISTS idx_weight_logs_customer ON inventory_weight_logs (customer_id);
CREATE INDEX IF NOT EXISTS idx_weight_logs_created_at ON inventory_weight_logs (created_at DESC);
