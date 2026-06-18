-- ============================================================
-- Cloud9 OS — Migration 018: storage footprint (m³ per client)
-- Storage space each fulfilment client occupies, derived from Helm package
-- dimensions: per SKU per location, volume = stock × (L×W×H ÷ items-per-box)
-- in cubic metres. One row per (inventory item, location).
-- ============================================================

CREATE TABLE IF NOT EXISTS storage_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helm_inventory_id VARCHAR(64) NOT NULL,
  sku              VARCHAR(160),
  name             VARCHAR(255),
  customer_id      UUID REFERENCES customers(id) ON DELETE SET NULL,
  helm_client_id   VARCHAR(64),
  location_id      VARCHAR(64),
  location_name    VARCHAR(160),
  warehouse_id     INTEGER,
  qty              INTEGER NOT NULL DEFAULT 0,
  unit_m3          NUMERIC(14,6) NOT NULL DEFAULT 0,   -- m³ per single unit
  volume_m3        NUMERIC(14,4) NOT NULL DEFAULT 0,   -- qty × unit_m3
  has_dimensions   BOOLEAN NOT NULL DEFAULT false,     -- false = no package config, volume unknown
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_inv_loc ON storage_lines(helm_inventory_id, location_id);
CREATE INDEX IF NOT EXISTS idx_storage_customer ON storage_lines(customer_id);
CREATE INDEX IF NOT EXISTS idx_storage_location ON storage_lines(location_id);
