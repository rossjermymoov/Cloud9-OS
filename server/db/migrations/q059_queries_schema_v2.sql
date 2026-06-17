-- 059: Queries & Claims — schema v2
--
-- Adds:
--   1. Full query_status lifecycle (awaiting_customer_info through claim resolution)
--   2. query_evidence table for customer-provided docs and goods info
--   3. courier_query_config table — per-courier email addresses, chase days, claim deadlines
--   4. email_templates table — HTML templates for all customer-facing communications

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend query_status enum
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE query_status ADD VALUE IF NOT EXISTS 'awaiting_customer_info'  AFTER 'open';
ALTER TYPE query_status ADD VALUE IF NOT EXISTS 'info_received'           AFTER 'awaiting_customer_info';
ALTER TYPE query_status ADD VALUE IF NOT EXISTS 'courier_investigating'   AFTER 'awaiting_courier';
ALTER TYPE query_status ADD VALUE IF NOT EXISTS 'claim_raised'            AFTER 'courier_investigating';
ALTER TYPE query_status ADD VALUE IF NOT EXISTS 'awaiting_claim_docs'     AFTER 'claim_raised';
ALTER TYPE query_status ADD VALUE IF NOT EXISTS 'claim_submitted'         AFTER 'awaiting_claim_docs';
ALTER TYPE query_status ADD VALUE IF NOT EXISTS 'resolved_claim_approved' AFTER 'resolved';
ALTER TYPE query_status ADD VALUE IF NOT EXISTS 'resolved_claim_rejected' AFTER 'resolved_claim_approved';

-- Add claim deadline tracking to queries
ALTER TABLE queries
  ADD COLUMN IF NOT EXISTS claim_number          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS claim_deadline_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claim_amount          NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS approved_amount       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS assigned_to           UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_chased_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS courier_chased_at     TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Query evidence
-- Customer-provided information and documents for a query/claim
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS query_evidence (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id            UUID NOT NULL REFERENCES queries(id) ON DELETE CASCADE,

  evidence_type       VARCHAR(50) NOT NULL,
  -- Types: goods_description | cost_price | sale_price | photos_damage |
  --        photos_packaging | invoice_pdf | shipment_label | item_description |
  --        weight | parcel_count | imei_serial | claim_summary | other

  -- Text value (for descriptions, summaries)
  value_text          TEXT,

  -- Numeric value (for prices, weights, counts)
  value_numeric       NUMERIC(10,2),
  value_unit          VARCHAR(20),              -- 'GBP', 'kg', 'units'

  -- File attachment
  file_url            TEXT,
  file_name           VARCHAR(255),
  file_format         VARCHAR(20),             -- 'pdf', 'jpg', 'png', 'eml' etc
  file_size_bytes     INTEGER,

  -- Who provided it
  provided_by_email   VARCHAR(255),
  provided_by_name    VARCHAR(255),
  is_courier_approved BOOLEAN DEFAULT false,   -- false = pending review, true = accepted by courier

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_evidence_query ON query_evidence(query_id);
CREATE INDEX IF NOT EXISTS idx_query_evidence_type  ON query_evidence(query_id, evidence_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Courier query config
-- Per-courier settings for query and claim handling
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS courier_query_config (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_code            VARCHAR(20) NOT NULL UNIQUE,
  courier_name            VARCHAR(100) NOT NULL,

  -- Email addresses
  query_email             VARCHAR(255),        -- first point of contact
  claims_email            VARCHAR(255),        -- once escalated to formal claim

  -- Chase windows (calendar days)
  query_chase_days        SMALLINT DEFAULT 3,  -- chase courier after N days of no response
  claim_chase_days        SMALLINT DEFAULT 5,
  customer_chase_days     SMALLINT  DEFAULT 3, -- chase customer after N days if awaiting docs

  -- Claim deadlines and processing
  claim_deadline_days     SMALLINT DEFAULT 28, -- days customer has to submit claim form
  claim_processing_days   SMALLINT DEFAULT 12, -- working days courier takes to process
  claim_processing_unit   VARCHAR(20) DEFAULT 'working_days', -- 'working_days' | 'calendar_days'

  -- Evidence requirements (what this courier always asks for)
  requires_cost_invoice   BOOLEAN DEFAULT true,
  requires_photos         BOOLEAN DEFAULT true,
  requires_label          BOOLEAN DEFAULT true,
  invoice_must_be_pdf     BOOLEAN DEFAULT true,
  no_retail_invoices      BOOLEAN DEFAULT true,  -- courier won't accept retail price invoices

  -- Any courier-specific notes to include in communications
  claim_notes             TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed DPD
INSERT INTO courier_query_config (
  courier_code, courier_name,
  query_email, claims_email,
  query_chase_days, claim_chase_days, customer_chase_days,
  claim_deadline_days, claim_processing_days,
  requires_cost_invoice, requires_photos, requires_label,
  invoice_must_be_pdf, no_retail_invoices,
  claim_notes
) VALUES (
  'dpd', 'DPD',
  'platinum@dpd.co.uk', 'investigations@dpd.co.uk',
  3, 5, 3,
  28, 12,
  true, true, true,
  true, true,
  'DPD will only pay out at supplier cost price, not the resale price. Invoices must be in PDF format — DPD will not accept Word, Excel, or email attachments. The claim form is sent to service@moovparcel.co.uk and may go to junk/spam.'
) ON CONFLICT (courier_code) DO NOTHING;

-- Seed Evri (placeholder — update email addresses when known)
INSERT INTO courier_query_config (
  courier_code, courier_name,
  query_chase_days, claim_deadline_days, claim_processing_days
) VALUES (
  'evri', 'Evri', 3, 28, 10
) ON CONFLICT (courier_code) DO NOTHING;

-- Seed UPS (placeholder)
INSERT INTO courier_query_config (
  courier_code, courier_name,
  query_chase_days, claim_deadline_days, claim_processing_days
) VALUES (
  'ups', 'UPS', 3, 30, 10
) ON CONFLICT (courier_code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Email templates
-- HTML templates with {{placeholder}} variables for all customer comms
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key        VARCHAR(100) NOT NULL UNIQUE,
  name                VARCHAR(200) NOT NULL,
  description         TEXT,
  subject_template    VARCHAR(500) NOT NULL,
  body_html           TEXT NOT NULL,
  body_text           TEXT,                    -- plain text fallback
  courier_code        VARCHAR(20),             -- NULL = all couriers, or courier-specific override
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Template keys (HTML bodies are seeded in migration 060)
INSERT INTO email_templates (template_key, name, description, subject_template, body_html) VALUES
  ('query_acknowledgement',
   'Query Acknowledgement',
   'Sent immediately when a customer query is received',
   'We''ve received your query — Consignment {{consignment_number}}',
   'PENDING_SEED'),

  ('customer_info_request',
   'Customer Information Request',
   'Sent to collect goods description, cost price, photos and invoice before contacting courier',
   'We need a few details to progress your query — {{consignment_number}}',
   'PENDING_SEED'),

  ('courier_escalated_holding',
   'Courier Escalated — Holding Update',
   'Sent to customer once Moov has contacted the courier',
   'Update on your query — {{consignment_number}}',
   'PENDING_SEED'),

  ('investigation_update',
   'Investigation Update from Courier',
   'Forwards courier investigation status to customer in clean language',
   'Update from {{courier_name}} — {{consignment_number}}',
   'PENDING_SEED'),

  ('claim_documents_needed',
   'Claim Documents Needed',
   'Parcel confirmed lost/damaged — requesting final claim docs from customer',
   'Important: We need your documents to submit your claim — {{consignment_number}}',
   'PENDING_SEED'),

  ('claim_doc_reminder',
   'Claim Document Reminder',
   'Chase customer for outstanding claim documents with deadline countdown',
   'Reminder: {{days_remaining}} days left to submit your claim — {{consignment_number}}',
   'PENDING_SEED'),

  ('claim_submitted',
   'Claim Submitted Confirmation',
   'Confirms to customer that claim has been submitted to courier',
   'Your claim has been submitted — {{consignment_number}}',
   'PENDING_SEED'),

  ('claim_approved',
   'Claim Approved',
   'Great news — claim approved, advises payout amount and next steps',
   'Great news — your claim has been approved — {{consignment_number}}',
   'PENDING_SEED'),

  ('claim_rejected',
   'Claim Rejected',
   'Claim rejected — explains reason and options',
   'Update on your claim — {{consignment_number}}',
   'PENDING_SEED'),

  ('query_resolved_delivered',
   'Query Resolved — Parcel Delivered',
   'Parcel has now been delivered, closing the query',
   'Your parcel has been delivered — {{consignment_number}}',
   'PENDING_SEED')

ON CONFLICT (template_key) DO NOTHING;
