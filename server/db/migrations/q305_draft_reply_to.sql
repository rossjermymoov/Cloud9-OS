-- 305_draft_reply_to.sql
-- Pair every AI draft with the exact inbound message it is responding to, so the
-- Quick View can show the triggering message (not just the ticket-opening text).
-- (in_reply_to already exists for the Gmail RFC message-id; this is our internal
-- query_emails.id reference.)

ALTER TABLE query_emails
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID
    REFERENCES query_emails(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_query_emails_reply_to ON query_emails(reply_to_message_id);

-- Backfill existing drafts → most recent inbound message on the same ticket.
UPDATE query_emails d
SET reply_to_message_id = sub.id
FROM (
  SELECT DISTINCT ON (query_id) query_id, id
  FROM query_emails
  WHERE direction IN ('inbound_customer','inbound_courier')
  ORDER BY query_id, COALESCE(received_at, created_at) DESC
) sub
WHERE d.is_ai_draft = true
  AND d.reply_to_message_id IS NULL
  AND d.query_id = sub.query_id;
