-- 310_learned_behaviors.sql
-- Autonomous learning: when a supervisor refines a draft, the system abstracts
-- the underlying business rule and commits it here automatically (no button).
-- learning_nudges drives the dashboard "we learned something" toast.

CREATE TABLE IF NOT EXISTS learned_behaviors (
  id               SERIAL PRIMARY KEY,
  scenario_trigger TEXT NOT NULL,                -- e.g. 'dpd_parcel_returned'
  core_instruction TEXT NOT NULL,                -- the abstracted reusable rule
  courier_code     VARCHAR(50),
  issue_type       VARCHAR(50),
  source_query_id  UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_learned_behaviors_scenario ON learned_behaviors(scenario_trigger);

CREATE TABLE IF NOT EXISTS learning_nudges (
  id               SERIAL PRIMARY KEY,
  scenario_trigger TEXT NOT NULL,
  core_instruction TEXT,
  courier_code     VARCHAR(50),
  issue_type       VARCHAR(50),
  match_count      INTEGER NOT NULL DEFAULT 0,
  dismissed        BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_learning_nudges_open ON learning_nudges(dismissed, created_at DESC);
