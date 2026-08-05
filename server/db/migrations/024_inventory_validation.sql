-- ============================================================
-- Cloud9 OS — Migration 024: Inventory validator runs
-- Stores the result of an "interrogate this customer's inventory for these
-- fields" job. Runs in the background (all-customers + per-item detail can be
-- thousands of Helm calls), so the frontend polls for the result.
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_validation_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         VARCHAR(20) NOT NULL DEFAULT 'customer',   -- 'customer' | 'all'
  customer_id   UUID,
  fields        JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        VARCHAR(20) NOT NULL DEFAULT 'running',     -- running | ok | error
  items_checked INTEGER NOT NULL DEFAULT 0,
  issues_found  INTEGER NOT NULL DEFAULT 0,
  result        JSONB,
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inv_val_runs_started ON inventory_validation_runs (started_at DESC);
