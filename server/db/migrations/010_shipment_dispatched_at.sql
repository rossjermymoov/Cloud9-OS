-- ============================================================
-- Cloud9 OS — Migration 010: shipment despatch date
-- Daily volume must be counted by DESPATCH date (when the label/shipment was
-- created), not collection date — collection dates are often null or forward,
-- which silently dropped parcels from the daily totals.
-- ============================================================

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS dispatched_at DATE;
CREATE INDEX IF NOT EXISTS idx_shipments_dispatched ON shipments(customer_id, dispatched_at);
