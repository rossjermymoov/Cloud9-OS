-- 312_triage_intent.sql
-- Records the LLM-inferred transactional intent (courier_chase, ticket_closure,
-- information_request, complaint, other) so the dashboard can pivot the courier
-- panel — e.g. show "Issue Resolved / Suspended" for closures.

ALTER TABLE queries
  ADD COLUMN IF NOT EXISTS triage_intent TEXT;
