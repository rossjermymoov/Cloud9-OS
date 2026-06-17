-- 076: SLA engine, email read tracking, inbox view refresh
--
-- Adds:
--   1. read_at column on query_emails  (marks when staff opened the query)
--   2. sla_policies  — per-courier/per-type SLA definitions
--   3. sla_rules     — keyword / condition-based rules that auto-select a policy
--   4. query_sla_assignments — active SLA deadline per query
--   5. Refreshed queries_inbox_view with unread_emails, has_new_reply, SLA timer

ALTER TABLE query_emails
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_query_emails_unread
  ON query_emails(query_id, read_at)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS sla_policies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL,
  courier_code    VARCHAR(20),
  query_type      query_type,
  category        VARCHAR(50),
  duration_hours  INT NOT NULL,
  priority        INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  CREATE TYPE sla_rule_condition AS ENUM ('keyword', 'query_type', 'courier', 'status');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sla_trigger_type AS ENUM ('auto_policy', 'rule_match', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS sla_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100) NOT NULL,
  condition_type   sla_rule_condition NOT NULL,
  condition_value  TEXT NOT NULL,
  policy_id        UUID NOT NULL REFERENCES sla_policies(id) ON DELETE CASCADE,
  priority         INT NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS query_sla_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id        UUID NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  policy_id       UUID REFERENCES sla_policies(id) ON DELETE SET NULL,
  policy_name     VARCHAR(100) NOT NULL,
  duration_hours  INT NOT NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at          TIMESTAMPTZ NOT NULL,
  triggered_by    sla_trigger_type NOT NULL DEFAULT 'auto_policy',
  rule_id         UUID REFERENCES sla_rules(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_assignments_active
  ON query_sla_assignments(query_id)
  WHERE is_active = true;

ALTER TYPE query_type ADD VALUE IF NOT EXISTS 'claim' AFTER 'other';

INSERT INTO sla_policies (name, courier_code, query_type, duration_hours, priority) VALUES
  ('DPD Claim',                    'dpd',   'claim',           168, 100),
  ('DHL Claim',                    'dhl',   'claim',           168, 100),
  ('Yodel Claim',                  'yodel', 'claim',           168, 100),
  ('Evri Claim',                   'evri',  'claim',           168, 100),
  ('Default Claim (14 days)',       NULL,   'claim',           336,  50),
  ('Not Delivered',                 NULL,   'not_delivered',     4,  80),
  ('Damaged',                       NULL,   'damaged',           4,  80),
  ('Missing Items',                 NULL,   'missing_items',     4,  80),
  ('Late Delivery',                 NULL,   'delay',            24,  80),
  ('General Query Default',         NULL,    NULL,               4,   0)
ON CONFLICT DO NOTHING;

INSERT INTO sla_rules (name, condition_type, condition_value, policy_id, priority)
SELECT 'Keyword: urgent',   'keyword', 'urgent',   p.id, 200 FROM sla_policies p WHERE p.name = 'Not Delivered'
ON CONFLICT DO NOTHING;

INSERT INTO sla_rules (name, condition_type, condition_value, policy_id, priority)
SELECT 'Keyword: software', 'keyword', 'software', p.id, 200 FROM sla_policies p WHERE p.name = 'Not Delivered'
ON CONFLICT DO NOTHING;

DROP VIEW IF EXISTS queries_inbox_view;

CREATE VIEW queries_inbox_view AS
SELECT
  q.id,
  q.consignment_number,
  q.customer_name,
  q.customer_id,
  q.courier_name,
  q.courier_code,
  q.service_name,
  q.trigger,
  q.query_type,
  q.status,
  q.subject,
  q.requires_attention,
  q.attention_reason,
  q.autopilot_enabled,
  q.sender_email,
  q.sender_matched,
  q.claim_number,
  q.claim_deadline_at,
  q.claim_amount,
  q.freshdesk_ticket_number,
  q.ai_confidence,
  q.created_at,
  q.updated_at,
  q.first_response_at,
  q.first_response_mins,
  q.resolved_at,
  EXTRACT(EPOCH FROM (NOW() - q.created_at)) / 86400 AS age_days,
  CASE
    WHEN q.claim_deadline_at IS NOT NULL
    THEN CEIL(EXTRACT(EPOCH FROM (q.claim_deadline_at - NOW())) / 86400)
    ELSE NULL
  END AS claim_days_remaining,
  (SELECT COUNT(*) FROM query_emails qe
   WHERE qe.query_id = q.id
     AND qe.is_ai_draft = true
     AND qe.sent_at IS NULL
     AND qe.ai_draft_approved_by IS NULL
  ) AS pending_drafts,
  (SELECT qe.body_text FROM query_emails qe
   WHERE qe.query_id = q.id
   ORDER BY qe.created_at DESC LIMIT 1
  ) AS latest_email_preview,
  (SELECT qe.direction FROM query_emails qe
   WHERE qe.query_id = q.id
   ORDER BY qe.created_at DESC LIMIT 1
  ) AS latest_email_direction,
  (SELECT qe.created_at FROM query_emails qe
   WHERE qe.query_id = q.id
   ORDER BY qe.created_at DESC LIMIT 1
  ) AS latest_email_at,
  (SELECT COUNT(*) FROM query_notifications qn
   WHERE qn.query_id = q.id AND qn.read_at IS NULL
  ) AS unread_notifications,
  (SELECT COUNT(*) FROM query_emails qe
   WHERE qe.query_id = q.id
     AND qe.direction IN ('inbound_customer', 'inbound_courier')
     AND qe.read_at IS NULL
     AND qe.is_ai_draft = false
  ) AS unread_emails,
  (SELECT EXISTS(
    SELECT 1 FROM query_emails qe
    WHERE qe.query_id = q.id
      AND qe.direction IN ('inbound_customer', 'inbound_courier')
      AND qe.read_at IS NULL
      AND qe.is_ai_draft = false
      AND qe.created_at = (
        SELECT MAX(qe2.created_at) FROM query_emails qe2
        WHERE qe2.query_id = q.id AND qe2.is_ai_draft = false
      )
  )) AS has_new_reply,
  COALESCE(
    sa.due_at,
    CASE WHEN s.sla_hours IS NOT NULL
      THEN q.created_at + (s.sla_hours || ' hours')::INTERVAL
      ELSE NULL
    END
  ) AS sla_due_at,
  COALESCE(sa.duration_hours, s.sla_hours) AS sla_hours,
  sa.policy_name AS sla_policy_name,
  CASE
    WHEN COALESCE(
      sa.due_at,
      CASE WHEN s.sla_hours IS NOT NULL THEN q.created_at + (s.sla_hours || ' hours')::INTERVAL ELSE NULL END
    ) IS NOT NULL
    THEN NOW() > COALESCE(
        sa.due_at,
        CASE WHEN s.sla_hours IS NOT NULL THEN q.created_at + (s.sla_hours || ' hours')::INTERVAL ELSE NULL END
      )
      AND q.status NOT IN ('resolved', 'resolved_claim_approved', 'resolved_claim_rejected')
    ELSE false
  END AS sla_breached,
  CASE
    WHEN COALESCE(
      sa.due_at,
      CASE WHEN s.sla_hours IS NOT NULL THEN q.created_at + (s.sla_hours || ' hours')::INTERVAL ELSE NULL END
    ) IS NOT NULL
    THEN EXTRACT(EPOCH FROM (
      COALESCE(
        sa.due_at,
        CASE WHEN s.sla_hours IS NOT NULL THEN q.created_at + (s.sla_hours || ' hours')::INTERVAL ELSE NULL END
      ) - NOW()
    )) / 60
    ELSE NULL
  END AS sla_mins_remaining
FROM queries q
LEFT JOIN service_slas s
  ON  s.service_code = q.service_code
  AND s.courier_code = q.courier_code
LEFT JOIN query_sla_assignments sa
  ON  sa.query_id = q.id
  AND sa.is_active = true;
