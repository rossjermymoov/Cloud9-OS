-- ============================================================
-- Cloud9 OS — Migration 030: Customer SLA Lead Days / Offset
-- Allows per-client SLA adaptations (e.g. SO Wood engraving,
-- custom packaging) where standard same-day / next-day dispatch
-- requires +1, +2, or more working days lead time before being
-- flagged on the SLA exceptions / breach report.
-- ============================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS sla_lead_days INTEGER NOT NULL DEFAULT 0;
