-- ============================================================
-- Cloud9 OS — Migration 017: label-based timing for bulk picks
-- Bulk pickers (e.g. Mark Lewis) bypass the scan flow, so Helm records no
-- per-scan durations. For those picks we time them by the gap between
-- consecutive picks ("between batches"), using the order's actual dispatch /
-- shipment-label time as the pick's completion moment.
--   label_at       — when the pick's last order was dispatched (label created)
--   timing_source  — 'scan' (real scan timing) | 'gap' (derived) | NULL (none yet)
-- ============================================================

ALTER TABLE picks ADD COLUMN IF NOT EXISTS label_at      TIMESTAMPTZ;
ALTER TABLE picks ADD COLUMN IF NOT EXISTS timing_source VARCHAR(10);
CREATE INDEX IF NOT EXISTS idx_picks_picker_label ON picks(picker_id, label_at);
