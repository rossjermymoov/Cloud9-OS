-- ============================================================
-- Cloud9 OS — Migration 012: Picking analytics
-- Pull-side store for Helm picks (List Picks + Get Pick Detail) so we can
-- report picks/day, items per pick, time per pick and picker performance.
-- `pick_events` (migration 006) was a webhook capture stub; this is the
-- richer analytics table the Picking dashboard reads from.
--
-- Helm status: 0 OPEN, 1 COMPLETED, 2 CANCELLED, 3 INPROGRESS, 4 IDLE
-- pick_type:   1 Single, 2 Multi   |   pick_option: 1 Order-by-order, 2 Bulk&Sort, 3 Tote, 4 Bulk
-- ============================================================

-- Warehouse users, so picker IDs resolve to names on the leaderboard.
CREATE TABLE IF NOT EXISTS helm_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helm_user_id  VARCHAR(64) NOT NULL,
  name          VARCHAR(200),
  email         VARCHAR(200),
  role          VARCHAR(120),
  active        BOOLEAN NOT NULL DEFAULT true,
  raw_payload   JSONB,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_helm_users_helm_id ON helm_users(helm_user_id);

CREATE TABLE IF NOT EXISTS picks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helm_pick_id    VARCHAR(64) NOT NULL,
  pick_number     VARCHAR(120),
  pick_type       INTEGER,
  pick_type_name  VARCHAR(60),
  pick_option     INTEGER,
  pick_option_name VARCHAR(60),
  status          INTEGER,
  status_name     VARCHAR(60),
  warehouse_id    INTEGER,
  created_by      VARCHAR(64),
  picker_id       VARCHAR(64),          -- assigned_to / picked_by
  picker_name     VARCHAR(200),
  item_count      INTEGER NOT NULL DEFAULT 0,   -- sum of quantity_picked across pick_inventories
  line_count      INTEGER NOT NULL DEFAULT 0,   -- number of pick_inventories
  order_count     INTEGER NOT NULL DEFAULT 0,   -- distinct order_summary_id
  handling_ms     BIGINT  NOT NULL DEFAULT 0,   -- sum of time_tracking_data durations (active time)
  elapsed_ms      BIGINT  NOT NULL DEFAULT 0,   -- completed_at - created_at (wall-clock)
  is_batch        BOOLEAN NOT NULL DEFAULT false,
  is_split        BOOLEAN NOT NULL DEFAULT false,
  ui_pick         BOOLEAN NOT NULL DEFAULT false,
  force_completed BOOLEAN NOT NULL DEFAULT false,
  helm_created_at TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  pick_date       DATE,                 -- completion date (fallback created date) for daily buckets
  raw_payload     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_picks_helm_id   ON picks(helm_pick_id);
CREATE INDEX IF NOT EXISTS idx_picks_date             ON picks(pick_date DESC);
CREATE INDEX IF NOT EXISTS idx_picks_picker           ON picks(picker_id);
CREATE INDEX IF NOT EXISTS idx_picks_status           ON picks(status);

CREATE TRIGGER trg_picks_updated_at BEFORE UPDATE ON picks
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
