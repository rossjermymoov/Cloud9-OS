-- ============================================================
-- Cloud9 OS — Migration 008: item_count on shipments
-- Voila shipments are the source of truth for dispatch volume:
-- parcels = create_label_parcels length, items = sum of every parcel item qty.
-- ============================================================

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS item_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_shipments_cust_date ON shipments(customer_id, collection_date);
