-- 083: Ticket priority, group assignment, and ticket number
--
-- Adds:
--   1. ticket_priority ENUM and priority column on queries
--   2. group_name TEXT column on queries (team/department assignment)
--   3. ticket_number SERIAL for human-readable ticket references (#1, #2, …)
--   4. Refreshed queries_inbox_view with new fields + assigned staff name

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Priority ENUM
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ticket_priority AS ENUM ('urgent', 'high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE queries
  ADD COLUMN IF NOT EXISTS priority      ticket_priority NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS group_name    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS ticket_number BIGINT;

-- Auto-assign ticket_number from a sequence
CREATE SEQUENCE IF NOT EXISTS queries_ticket_number_seq START 1000;

-- Back-fill existing queries with sequential numbers
UPDATE queries
SET ticket_number = nextval('queries_ticket_number_seq')
WHERE ticket_number IS NULL;

-- Default for new rows
ALTER TABLE queries
  ALTER COLUMN ticket_number SET DEFAULT nextval('queries_ticket_number_seq');

CREATE INDEX IF NOT EXISTS idx_queries_priority    ON queries(priority);
CREATE INDEX IF NOT EXISTS idx_queries_group       ON queries(group_name);
CREATE INDEX IF NOT EXISTS idx_queries_ticket_num  ON queries(ticket_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Refreshed inbox view — adds priority, group_name, ticket_number,
--    assigned staff name, and assignee_email
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS queries_inbox_view;

CREATE VIEW queries_inbox_view AS
SELECT
  q.id,
  q.ticket_number,
  q.consignment_number,
  q.customer_name,
  q.customer_id,
  q.courier_name,
  q.courier_code,
  q.service_name,
  q.trigger,
  q.query_type,
  q.status,
  q.priority,
  q.group_name,
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
  q.assigned_to,
  -- Denormalised staff name + email for display without JOIN in the frontend
  st.full_name AS assignee_name,
  st.email     AS assignee_email,

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

  -- SLA timing
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
  AND sa.is_active = true
LEFT JOIN staff st
  ON  st.id = q.assigned_to;
