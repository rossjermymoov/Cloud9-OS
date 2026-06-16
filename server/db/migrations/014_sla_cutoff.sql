-- ============================================================
-- Cloud9 OS — Migration 014: On-time dispatch SLA
-- Every customer has a daily dispatch cutoff (default 14:00, Europe/London).
-- An order received before cutoff on a WORKING day must ship that day; after
-- cutoff, or on a weekend / UK bank holiday, it rolls to the next working day.
-- Bank holidays come from gov.uk (england-and-wales division), cached here.
-- ============================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS cutoff_time TIME NOT NULL DEFAULT '14:00:00';

CREATE TABLE IF NOT EXISTS bank_holidays (
  holiday_date  DATE NOT NULL,
  division      VARCHAR(40) NOT NULL DEFAULT 'england-and-wales',
  title         VARCHAR(160),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (division, holiday_date)
);
CREATE INDEX IF NOT EXISTS idx_bank_holidays_date ON bank_holidays(holiday_date);

-- SLA reads orders by when they were received.
CREATE INDEX IF NOT EXISTS idx_orders_received ON orders(received_at) WHERE received_at IS NOT NULL;
