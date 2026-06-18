-- ============================================================
-- Cloud9 OS — Migration 020: app settings (global key/value)
-- A tiny key/value store for global operational settings that aren't per-customer.
-- First use: the picking "day window" (start/end hour) that drives the hourly
-- Waves-per-hour chart, so the warehouse's working hours are editable rather than
-- hard-coded. value is JSONB so each setting can hold whatever shape it needs.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key        VARCHAR(80) PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default picking day window: first wave bucketed 08:00–09:00, last 17:00–18:00.
INSERT INTO app_settings (key, value)
VALUES ('picking_day_window', '{"start_hour": 8, "end_hour": 18}'::jsonb)
ON CONFLICT (key) DO NOTHING;
