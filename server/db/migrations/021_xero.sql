-- ============================================================
-- Cloud9 OS — Migration 021: Xero accounting integration
-- One OAuth connection (single Xero org) + per-customer contact links so we can
-- show live invoices/balances on each customer record.
-- ============================================================

CREATE TABLE IF NOT EXISTS xero_tokens (
  id            SERIAL PRIMARY KEY,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  tenant_id     VARCHAR(80),
  tenant_name   VARCHAR(200),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Link each customer to its Xero contact + cache the last-seen outstanding balance.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS xero_contact_id   VARCHAR(64);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS xero_contact_name VARCHAR(255);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ledger_balance    NUMERIC(12,2);
