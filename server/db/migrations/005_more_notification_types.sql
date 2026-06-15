-- ============================================================
-- Cloud9 OS — Migration 005: extra notification types
-- New Helm webhook events that surface in the Notification Center.
-- (ALTER TYPE ADD VALUE runs as its own statement — not inside a txn.)
-- ============================================================

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'new_client';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'delivery_created';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'return_created';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'pick_completed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'inventory_created';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'order_dispatched';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'purchase_order_updated';
