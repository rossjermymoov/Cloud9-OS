-- 300_courier_routing.sql
-- Live courier routing table — the outbound destination for automated courier
-- inquiries, replacing the hardcoded TODO- placeholders in courierTemplates.js.
-- One row per courier: a general queries address and a claims/disputes address.
--
-- NOTE: a legacy `courier_query_config` table (query_email / claims_email) also
-- exists; this is the new canonical table the automation engine reads from.

CREATE TABLE IF NOT EXISTS courier_routing_rules (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_code         VARCHAR(40) NOT NULL UNIQUE,
  courier_name         VARCHAR(80),
  general_query_email  VARCHAR(255),
  claims_email         VARCHAR(255),
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_courier_routing_code ON courier_routing_rules(courier_code);

-- Seed the couriers we automate. Emails left NULL for an admin to fill in via
-- settings before live sending; the automation falls back gracefully when null.
INSERT INTO courier_routing_rules (courier_code, courier_name, general_query_email, claims_email) VALUES
  ('dpd',  'DPD',  NULL, NULL),
  ('dhl',  'DHL',  NULL, NULL),
  ('evri', 'Evri', NULL, NULL)
ON CONFLICT (courier_code) DO NOTHING;
