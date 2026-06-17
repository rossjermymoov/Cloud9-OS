-- 311_audit_logs.sql
-- True audit trail of executed system actions. The dashboard "Autopilot Runs"
-- metric counts rows here with action_type = 'autopilot_dispatch'. Nothing is
-- auto-dispatched in sandbox/staging, so the table is empty and the metric reads
-- 0 — and only ever increments when a genuine autonomous send is logged.

CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  action_type VARCHAR(60) NOT NULL,      -- e.g. 'autopilot_dispatch'
  query_id    UUID,
  actor       VARCHAR(120),              -- 'system' for autonomous actions
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action_type, created_at DESC);
