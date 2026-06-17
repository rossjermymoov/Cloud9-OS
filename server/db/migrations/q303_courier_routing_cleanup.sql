-- 303_courier_routing_cleanup.sql
-- Carrier routing is queries + claims only — no billing/finance endpoint (that
-- never flows through the automation loop). Rename general_query_email →
-- queries_email and seed the full carrier list (DPD/DHL/Evri/UPS/Yodel).

-- Rename the queries column if it still carries the old name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'courier_routing_rules' AND column_name = 'general_query_email')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'courier_routing_rules' AND column_name = 'queries_email')
  THEN
    ALTER TABLE courier_routing_rules RENAME COLUMN general_query_email TO queries_email;
  END IF;
END $$;

-- Safety net for fresh installs where the old column never existed.
ALTER TABLE courier_routing_rules ADD COLUMN IF NOT EXISTS queries_email VARCHAR(255);

-- Defensive: ensure no stray billing endpoint column lingers.
ALTER TABLE courier_routing_rules DROP COLUMN IF EXISTS billing_email;

-- Seed the remaining carriers so the settings dropdown lists all five.
INSERT INTO courier_routing_rules (courier_code, courier_name) VALUES
  ('ups',   'UPS'),
  ('yodel', 'Yodel')
ON CONFLICT (courier_code) DO NOTHING;
