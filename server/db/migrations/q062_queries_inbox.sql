-- 062: Queries inbox — operational layer
--
-- Adds:
--   1. Freshdesk cross-reference fields on queries
--   2. Autopilot fields — mode per query, attention flag, confidence
--   3. Autopilot rules — which template types can auto-send vs require human
--   4. Email sender mappings — unknown sender → customer matching
--   5. Query notifications — escalation/attention alert log
--   6. Inbox view — pre-built SQL view for the inbox list

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Freshdesk cross-reference and operational fields on queries
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE queries
  -- Freshdesk (parallel system during transition)
  ADD COLUMN IF NOT EXISTS freshdesk_ticket_id     BIGINT,
  ADD COLUMN IF NOT EXISTS freshdesk_ticket_number VARCHAR(20),

  -- Autopilot
  ADD COLUMN IF NOT EXISTS autopilot_enabled       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_attention      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attention_reason        TEXT,
  ADD COLUMN IF NOT EXISTS attention_raised_at     TIMESTAMPTZ,

  -- Email matching state
  ADD COLUMN IF NOT EXISTS sender_email            VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sender_matched          BOOLEAN NOT NULL DEFAULT false,

  -- SLA tracking
  ADD COLUMN IF NOT EXISTS first_response_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_response_mins     INTEGER;

CREATE INDEX IF NOT EXISTS idx_queries_attention    ON queries(requires_attention) WHERE requires_attention = true;
CREATE INDEX IF NOT EXISTS idx_queries_freshdesk    ON queries(freshdesk_ticket_id);
CREATE INDEX IF NOT EXISTS idx_queries_sender       ON queries(sender_email);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Autopilot rules
-- Defines which email template types can auto-send vs require human approval
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS query_autopilot_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key        VARCHAR(100) NOT NULL UNIQUE REFERENCES email_templates(template_key) ON DELETE CASCADE,
  can_autopilot       BOOLEAN NOT NULL DEFAULT false,
  min_confidence      NUMERIC(3,2) NOT NULL DEFAULT 0.90, -- min AI confidence to auto-send
  notes               TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed autopilot rules based on risk level
-- Human required: first contact, info requests, anything involving money or claims
-- Autopilot OK: holding updates, progress relays, reminders
INSERT INTO query_autopilot_rules (template_key, can_autopilot, min_confidence, notes) VALUES
  ('query_acknowledgement',    false, 0.95, 'First contact — always human reviewed'),
  ('customer_info_request',    false, 0.95, 'Requesting docs from customer — human reviewed'),
  ('courier_escalated_holding',true,  0.90, 'Simple holding update — safe to autopilot'),
  ('investigation_update',     true,  0.90, 'Forwarding courier update — safe to autopilot'),
  ('claim_documents_needed',   false, 0.99, 'Involves claim and money — always human'),
  ('claim_doc_reminder',       true,  0.90, 'Automated reminder — safe to autopilot'),
  ('claim_submitted',          false, 0.99, 'Claim confirmation — always human'),
  ('claim_approved',           false, 0.99, 'Financial outcome — always human'),
  ('claim_rejected',           false, 0.99, 'Financial outcome — always human'),
  ('query_resolved_delivered', true,  0.90, 'Resolution confirmation — safe to autopilot')
ON CONFLICT (template_key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Email sender mappings
-- Maps inbound email addresses to customer records
-- Allows manual matching of unknown senders + auto-match on future emails
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_sender_mappings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_address       VARCHAR(255) NOT NULL,
  email_domain        VARCHAR(255),             -- extracted domain for domain-level matching
  customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  match_type          VARCHAR(20) NOT NULL DEFAULT 'manual',
  -- match_type: 'manual' = staff matched it | 'account_email' = matches primary email
  --             'contact_email' = matches a contact record | 'domain' = domain match
  matched_by          UUID REFERENCES staff(id) ON DELETE SET NULL,
  matched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_verified         BOOLEAN NOT NULL DEFAULT false,
  notes               TEXT,
  UNIQUE (email_address, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_sender_mappings_email   ON email_sender_mappings(email_address);
CREATE INDEX IF NOT EXISTS idx_sender_mappings_domain  ON email_sender_mappings(email_domain);
CREATE INDEX IF NOT EXISTS idx_sender_mappings_customer ON email_sender_mappings(customer_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Unmatched inbound emails
-- Holds emails that arrived but couldn't be matched to a customer
-- Staff resolve these via the mapping tool
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS unmatched_emails (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id    VARCHAR(255) UNIQUE,
  gmail_thread_id     VARCHAR(255),
  from_address        VARCHAR(255) NOT NULL,
  from_name           VARCHAR(255),
  subject             VARCHAR(500),
  body_preview        TEXT,                     -- first 500 chars for display
  body_full           TEXT,
  received_at         TIMESTAMPTZ NOT NULL,
  resolved            BOOLEAN NOT NULL DEFAULT false,
  resolved_query_id   UUID REFERENCES queries(id) ON DELETE SET NULL,
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unmatched_emails_from   ON unmatched_emails(from_address);
CREATE INDEX IF NOT EXISTS idx_unmatched_emails_unresolved ON unmatched_emails(resolved) WHERE resolved = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Query notifications
-- Log of escalation/attention alerts sent to staff
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE query_notification_type AS ENUM (
  'attention_required',    -- AI flagged for human review
  'sla_breach',            -- SLA breached with no action
  'claim_deadline',        -- claim submission deadline approaching
  'courier_no_response',   -- courier hasn't replied within chase window
  'customer_no_response'   -- customer hasn't replied within chase window
);

CREATE TABLE IF NOT EXISTS query_notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id            UUID NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  notification_type   query_notification_type NOT NULL,
  message             TEXT NOT NULL,
  sent_to_email       VARCHAR(255),
  sent_in_app         BOOLEAN NOT NULL DEFAULT true,
  read_at             TIMESTAMPTZ,
  read_by             UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_query  ON query_notifications(query_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON query_notifications(read_at) WHERE read_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Inbox view
-- Pre-aggregated view for the inbox list — avoids N+1 queries in the UI
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW queries_inbox_view AS
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

  -- Days since created
  EXTRACT(EPOCH FROM (NOW() - q.created_at)) / 86400 AS age_days,

  -- Claim deadline countdown (days remaining)
  CASE
    WHEN q.claim_deadline_at IS NOT NULL
    THEN CEIL(EXTRACT(EPOCH FROM (q.claim_deadline_at - NOW())) / 86400)
    ELSE NULL
  END AS claim_days_remaining,

  -- Unread AI drafts awaiting human approval
  (SELECT COUNT(*) FROM query_emails qe
   WHERE qe.query_id = q.id
     AND qe.is_ai_draft = true
     AND qe.sent_at IS NULL
     AND qe.ai_draft_approved_by IS NULL
  ) AS pending_drafts,

  -- Most recent email summary for inbox preview
  (SELECT qe.body_text FROM query_emails qe
   WHERE qe.query_id = q.id
   ORDER BY qe.created_at DESC
   LIMIT 1
  ) AS latest_email_preview,

  (SELECT qe.direction FROM query_emails qe
   WHERE qe.query_id = q.id
   ORDER BY qe.created_at DESC
   LIMIT 1
  ) AS latest_email_direction,

  (SELECT qe.created_at FROM query_emails qe
   WHERE qe.query_id = q.id
   ORDER BY qe.created_at DESC
   LIMIT 1
  ) AS latest_email_at,

  -- Unread notifications count
  (SELECT COUNT(*) FROM query_notifications qn
   WHERE qn.query_id = q.id AND qn.read_at IS NULL
  ) AS unread_notifications,

  -- SLA info
  s.sla_hours,
  CASE
    WHEN s.sla_hours IS NOT NULL
    THEN q.created_at + (s.sla_hours || ' hours')::INTERVAL
    ELSE NULL
  END AS sla_due_at,
  CASE
    WHEN s.sla_hours IS NOT NULL
    THEN NOW() > q.created_at + (s.sla_hours || ' hours')::INTERVAL
      AND q.status NOT IN ('resolved', 'resolved_claim_approved', 'resolved_claim_rejected')
    ELSE false
  END AS sla_breached

FROM queries q
LEFT JOIN service_slas s
  ON s.service_code = q.service_code
  AND s.courier_code = q.courier_code;
