-- 313_autonomous_engine.sql
-- Autonomous Traffic-Controller engine: per-category calibration (workflow_trust),
-- SLA response thresholds (sla_configs), and dual-track / threading columns on the
-- `queries` table (Moov OS's ticket table — the spec's `tickets` maps to `queries`).

-- Per-category Probation→Autopilot calibration (courier_code + intent).
CREATE TABLE IF NOT EXISTS workflow_trust (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_code                VARCHAR(50) NOT NULL,
  intent                      VARCHAR(50) NOT NULL,
  consecutive_clean_approvals INT NOT NULL DEFAULT 0,   -- resets on edit, caps at 20
  autopilot_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  last_reset_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (courier_code, intent)
);

-- SLA response thresholds per workflow group (scope) + scream toggle.
CREATE TABLE IF NOT EXISTS sla_configs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_group          VARCHAR(50) NOT NULL UNIQUE,
  response_target_minutes INT NOT NULL,
  warning_buffer_minutes  INT NOT NULL DEFAULT 0,
  scream_to_google_chat   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sla_configs (workflow_group, response_target_minutes, warning_buffer_minutes) VALUES
  ('urgent',       30,  10),
  ('dpd_queries',  120, 30),
  ('dhl_chases',   240, 60),
  ('default',      240, 60)
ON CONFLICT (workflow_group) DO NOTHING;

-- Dual-track + threading state on the ticket.
ALTER TABLE queries
  ADD COLUMN IF NOT EXISTS courier_reference_id     VARCHAR(100),                 -- [Ref: Moov-XXXX]
  ADD COLUMN IF NOT EXISTS last_customer_response_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_courier_response_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS track_a_status           VARCHAR(30) DEFAULT 'Draft',   -- customer face
  ADD COLUMN IF NOT EXISTS track_b_status           VARCHAR(30) DEFAULT 'Standby', -- courier face
  ADD COLUMN IF NOT EXISTS google_chat_escalated    BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_queries_courier_ref ON queries(courier_reference_id);
