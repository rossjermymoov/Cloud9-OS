-- ============================================================
-- Cloud9 OS — Migration 013: per-picker contributions
-- A single Helm pick can be worked by more than one user (one starts/pauses,
-- another finishes). Helm's time_tracking_data carries a user_id + duration
-- (seconds) per action, and ITEM_SCAN actions carry the quantity confirmed.
-- We split each pick into per-user contributions so the leaderboard reflects
-- who actually did the work — not just who the pick was assigned to.
-- ============================================================

CREATE TABLE IF NOT EXISTS pick_contributions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helm_pick_id  VARCHAR(64) NOT NULL,
  user_id       VARCHAR(64) NOT NULL,
  picker_name   VARCHAR(200),
  items         INTEGER NOT NULL DEFAULT 0,   -- items this user confirmed (ITEM_SCAN qty)
  handling_ms   BIGINT  NOT NULL DEFAULT 0,   -- this user's active time on the pick
  scans         INTEGER NOT NULL DEFAULT 0,
  pick_date     DATE,
  warehouse_id  INTEGER,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pick_contrib_pick_user ON pick_contributions(helm_pick_id, user_id);
CREATE INDEX IF NOT EXISTS idx_pick_contrib_user ON pick_contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_pick_contrib_date ON pick_contributions(pick_date DESC);

-- How many distinct users worked a pick (for the per-pick "shared" indicator).
ALTER TABLE picks ADD COLUMN IF NOT EXISTS contributor_count INTEGER NOT NULL DEFAULT 1;
