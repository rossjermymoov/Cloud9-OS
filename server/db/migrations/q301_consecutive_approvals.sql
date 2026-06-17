-- 301_consecutive_approvals.sql
-- Trust metric for the Autopilot QA loop: how many times in a row a ticket's AI
-- drafts have been approved untouched. Resets to 0 whenever a draft is refined.
-- At the threshold (20) the dashboard surfaces an "Automation Stable" badge.

ALTER TABLE queries
  ADD COLUMN IF NOT EXISTS consecutive_approvals INTEGER NOT NULL DEFAULT 0;
