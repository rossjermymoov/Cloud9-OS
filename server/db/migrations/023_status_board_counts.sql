-- ============================================================
-- Cloud9 OS — Migration 023: Status Board live snapshot
-- Authoritative per-status order counts, pulled directly from Helm by status
-- (filters[status][]) rather than inferred from the incrementally-synced orders
-- table. Rebuilt on a schedule + on demand so the board matches Helm exactly.
-- ============================================================

CREATE TABLE IF NOT EXISTS status_board_counts (
  status_id  INTEGER PRIMARY KEY,
  name       VARCHAR(120),
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
