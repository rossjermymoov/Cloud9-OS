-- ============================================================
-- Cloud9 OS — Migration 019: per-item (per-pick) timing
-- A Helm "pick" record is really a WAVE (a batch of orders). The true unit of
-- picking work is an item scan: every time a picker scans an item line, Helm
-- logs an ITEM_SCAN action in time_tracking_data with its own duration (seconds)
-- and the quantity confirmed. We store, per wave and per contributor:
--   item_scan_ms    = Σ duration of ITEM_SCAN actions (active item-pick time)
--   item_scan_count = number of ITEM_SCAN actions (= number of picks)
-- so we can report a true "average time per pick" = item_scan_ms ÷ item_scan_count.
-- Only scan-based picking produces these; bulk picks (no scans) stay 0 and are
-- naturally excluded from the per-pick average.
-- ============================================================

ALTER TABLE picks              ADD COLUMN IF NOT EXISTS item_scan_ms    BIGINT  NOT NULL DEFAULT 0;
ALTER TABLE picks              ADD COLUMN IF NOT EXISTS item_scan_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pick_contributions ADD COLUMN IF NOT EXISTS item_scan_ms    BIGINT  NOT NULL DEFAULT 0;
ALTER TABLE pick_contributions ADD COLUMN IF NOT EXISTS item_scan_count INTEGER NOT NULL DEFAULT 0;
