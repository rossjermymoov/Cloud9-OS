-- ============================================================
-- Cloud9 OS — Migration 029: Helm Products Local Cache
-- Fast barcode lookup & nightly inventory sync
-- ============================================================

CREATE TABLE IF NOT EXISTS helm_products (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helm_id                VARCHAR(100) NOT NULL UNIQUE,
  sku                    VARCHAR(255),
  name                   TEXT,
  barcode                VARCHAR(255),
  barcodes               TEXT[] DEFAULT '{}',
  image_url              TEXT,
  customer_id            UUID REFERENCES customers(id) ON DELETE SET NULL,
  helm_customer_id       VARCHAR(100),
  customer_name          VARCHAR(255),
  length                 NUMERIC(12, 4),
  width                  NUMERIC(12, 4),
  height                 NUMERIC(12, 4),
  dimension_unit         VARCHAR(20) DEFAULT 'cm',
  weight_g               NUMERIC(12, 4),
  weight_kg              NUMERIC(12, 4),
  raw_weight             NUMERIC(12, 4),
  raw_unit               VARCHAR(20),
  stock_level            INT,
  locations              JSONB DEFAULT '[]',
  package_configurations JSONB DEFAULT '[]',
  raw_data               JSONB DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_helm_products_barcode ON helm_products (barcode);
CREATE INDEX IF NOT EXISTS idx_helm_products_barcodes_gin ON helm_products USING GIN (barcodes);
CREATE INDEX IF NOT EXISTS idx_helm_products_helm_id ON helm_products (helm_id);
CREATE INDEX IF NOT EXISTS idx_helm_products_sku ON helm_products (sku);
CREATE INDEX IF NOT EXISTS idx_helm_products_customer ON helm_products (customer_id);

CREATE TRIGGER trg_helm_products_updated_at BEFORE UPDATE ON helm_products
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
