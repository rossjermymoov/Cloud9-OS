-- ============================================================
-- Cloud9 OS — Migration 009: Helm PO status id
-- Keep Helm's real status_id so we can distinguish Submitted (13) from
-- Draft (11) / On Hold (12), and drive the Inbound / Exceptions / Archive views.
-- ============================================================

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS helm_status_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_po_helm_status ON purchase_orders(helm_status_id);
