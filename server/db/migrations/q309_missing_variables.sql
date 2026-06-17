-- 309_missing_variables.sql
-- Generalised information-gathering: records which mandatory operational details
-- were missing from an inbound message (comma-separated), so the dashboard can
-- show "awaiting customer clarification for: …" and keep the courier panel on
-- standby. Cleared once full context is gathered.

ALTER TABLE queries
  ADD COLUMN IF NOT EXISTS missing_variables TEXT;
