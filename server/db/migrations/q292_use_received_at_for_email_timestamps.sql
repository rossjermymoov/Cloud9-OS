-- Migration 292: Use received_at (actual email timestamp) instead of created_at
-- (import timestamp) for latest_email_at and age_days in queries_inbox_view.

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
  st.full_name AS assignee_name,
  st.email     AS assignee_email,

  c.health_score AS customer_happiness_score,

  -- Age based on earliest received email, not import time
  EXTRACT(EPOCH FROM (NOW() - COALESCE(
    (SELECT MIN(COALESCE(qe.received_at, qe.created_at)) FROM query_emails qe WHERE qe.query_id = q.id),
    q.created_at
  ))) / 86400 AS age_days,

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
   ORDER BY COALESCE(qe.received_at, qe.created_at) DESC LIMIT 1
  ) AS latest_email_preview,

  (SELECT qe.direction FROM query_emails qe
   WHERE qe.query_id = q.id
   ORDER BY COALESCE(qe.received_at, qe.created_at) DESC LIMIT 1
  ) AS latest_email_direction,

  -- Use received_at (real email time) not created_at (import time)
  (SELECT COALESCE(qe.received_at, qe.created_at) FROM query_emails qe
   WHERE qe.query_id = q.id
   ORDER BY COALESCE(qe.received_at, qe.created_at) DESC LIMIT 1
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
      AND COALESCE(qe.received_at, qe.created_at) = (
        SELECT MAX(COALESCE(qe2.received_at, qe2.created_at)) FROM query_emails qe2
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
    WHEN COALESCE(sa.due_at, CASE WHEN s.sla_hours IS NOT NULL THEN q.created_at + (s.sla_hours || ' hours')::INTERVAL ELSE NULL END) IS NOT NULL
    THEN NOW() > COALESCE(sa.due_at, CASE WHEN s.sla_hours IS NOT NULL THEN q.created_at + (s.sla_hours || ' hours')::INTERVAL ELSE NULL END)
      AND q.status NOT IN ('resolved', 'resolved_claim_approved', 'resolved_claim_rejected')
    ELSE false
  END AS sla_breached,

  CASE
    WHEN COALESCE(sa.due_at, CASE WHEN s.sla_hours IS NOT NULL THEN q.created_at + (s.sla_hours || ' hours')::INTERVAL ELSE NULL END) IS NOT NULL
    THEN EXTRACT(EPOCH FROM (COALESCE(sa.due_at, CASE WHEN s.sla_hours IS NOT NULL THEN q.created_at + (s.sla_hours || ' hours')::INTERVAL ELSE NULL END) - NOW())) / 60
    ELSE NULL
  END AS sla_mins_remaining

FROM queries q
LEFT JOIN service_slas s   ON s.service_code = q.service_code AND s.courier_code = q.courier_code
LEFT JOIN query_sla_assignments sa ON sa.query_id = q.id AND sa.is_active = true
LEFT JOIN staff st          ON st.id = q.assigned_to
LEFT JOIN customers c       ON c.id = q.customer_id;
