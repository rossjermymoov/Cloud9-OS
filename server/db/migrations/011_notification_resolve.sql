-- ============================================================
-- Cloud9 OS — Migration 011: resolvable notifications
-- Exception alerts (customs hold, failed delivery, etc.) are point-in-time
-- log entries. When the parcel later clears, the alert should auto-resolve
-- and drop out of "Recent activity" so the dashboard only shows live problems.
--   • resolved_at — when the alert was cleared (NULL = still open)
--   • ref         — the consignment number, so a later clearing event can
--                   find and resolve the matching alert.
-- ============================================================

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref VARCHAR(160);

-- Backfill ref on existing tracking-exception alerts. Their body was written as
-- "<consignment> — <description>", so the consignment is the part before " — ".
UPDATE notifications
   SET ref = split_part(body, ' — ', 1)
 WHERE type = 'tracking_exception'
   AND ref IS NULL
   AND body IS NOT NULL;

-- Immediately resolve any existing exception alert whose parcel has since
-- moved to a cleared / in-motion / delivered status. This clears the stale
-- "customs hold" rows that are no longer on hold.
UPDATE notifications n
   SET resolved_at = NOW()
  FROM parcels p
 WHERE n.type = 'tracking_exception'
   AND n.resolved_at IS NULL
   AND p.consignment_number = n.ref
   AND p.status IN ('collected', 'at_depot', 'in_transit', 'out_for_delivery', 'delivered');

-- Feed queries filter on open alerts, so index the open set.
CREATE INDEX IF NOT EXISTS idx_notifications_open
  ON notifications(created_at DESC) WHERE resolved_at IS NULL;
