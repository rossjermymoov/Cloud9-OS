-- ============================================================
-- Cloud9 OS — Migration 007: full unique indexes on Helm ids
-- The Helm-id indexes were partial (… WHERE col IS NOT NULL), which
-- `ON CONFLICT (col)` cannot infer without repeating the predicate. Switch them
-- to plain UNIQUE indexes (NULLs are still distinct, so manual rows without a
-- Helm id are unaffected) so every upsert works.
-- ============================================================

DROP INDEX IF EXISTS idx_customers_helm_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_helm_unique ON customers(helm_customer_id);

DROP INDEX IF EXISTS idx_orders_helm;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_helm ON orders(helm_order_id);

DROP INDEX IF EXISTS idx_po_helm;
CREATE UNIQUE INDEX IF NOT EXISTS idx_po_helm ON purchase_orders(helm_po_id);

DROP INDEX IF EXISTS idx_shipments_helm;
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_helm ON shipments(helm_shipment_id);

DROP INDEX IF EXISTS idx_returns_helm;
CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_helm ON returns(helm_return_id);

DROP INDEX IF EXISTS idx_pick_events_helm;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pick_events_helm ON pick_events(helm_pick_id);
