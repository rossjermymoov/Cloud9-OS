-- 299_sla_targets_and_triggers.sql
-- Freshdesk-style SLA architecture:
--   • SLA Targets  → named policy profiles with per-priority response/resolution hours
--   • SLA Triggers → IF (field/operator/value) THEN (set priority + link policy) rules
-- Non-destructive: legacy columns are kept and their NOT NULLs relaxed so the new
-- IF/THEN model can write rows without the old condition_type/condition_value shape.

-- ── 1. SLA Targets: per-priority response/resolution grid for each policy ──────
CREATE TABLE IF NOT EXISTS sla_policy_targets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id         UUID NOT NULL REFERENCES sla_policies(id) ON DELETE CASCADE,
  priority          ticket_priority NOT NULL,
  response_hours    INT,
  resolution_hours  INT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (policy_id, priority)
);

CREATE INDEX IF NOT EXISTS idx_sla_targets_policy ON sla_policy_targets(policy_id);

-- Let a policy exist as a pure named profile (targets carry the real numbers now).
ALTER TABLE sla_policies ALTER COLUMN duration_hours DROP NOT NULL;
ALTER TABLE sla_policies ADD COLUMN IF NOT EXISTS description TEXT;

-- ── 2. SLA Triggers: extend sla_rules with the IF/THEN matrix columns ──────────
ALTER TABLE sla_rules
  ADD COLUMN IF NOT EXISTS condition_field VARCHAR(20),   -- subject | sender_email | courier_code | body_text
  ADD COLUMN IF NOT EXISTS operator        VARCHAR(20),   -- contains | equals | starts_with
  ADD COLUMN IF NOT EXISTS match_value     TEXT,          -- e.g. 'P1', 'claims', '@dpd.co.uk'
  ADD COLUMN IF NOT EXISTS set_priority    ticket_priority;

-- Relax legacy NOT NULLs so new-style triggers can be inserted on their own.
-- (`priority` INT stays as the execution-order weight; higher = evaluated first.)
ALTER TABLE sla_rules ALTER COLUMN condition_type  DROP NOT NULL;
ALTER TABLE sla_rules ALTER COLUMN condition_value DROP NOT NULL;
ALTER TABLE sla_rules ALTER COLUMN policy_id       DROP NOT NULL;

-- ── 3. Backfill: give every existing policy a default 4-priority target grid ───
-- Mirrors the old single duration_hours into resolution, with a quartered response.
INSERT INTO sla_policy_targets (policy_id, priority, response_hours, resolution_hours)
SELECT p.id, pr.priority,
       GREATEST(1, CEIL(COALESCE(p.duration_hours, 24) / 4.0))::INT AS response_hours,
       COALESCE(p.duration_hours, 24)                        AS resolution_hours
FROM sla_policies p
CROSS JOIN (VALUES
  ('urgent'::ticket_priority),
  ('high'::ticket_priority),
  ('medium'::ticket_priority),
  ('low'::ticket_priority)
) AS pr(priority)
ON CONFLICT (policy_id, priority) DO NOTHING;
