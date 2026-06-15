-- ============================================================
-- Cloud9 OS — Migration 002: Helm sync fields
-- A Cloud9 customer maps to a Helm fulfilment_client. Store the Helm
-- accounts_id (which links to the accounting system / Xero contact) and
-- make helm_customer_id uniquely upsertable.
-- ============================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS helm_accounts_id VARCHAR(64);

-- One Cloud9 customer per Helm fulfilment_client.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_helm_unique
  ON customers(helm_customer_id) WHERE helm_customer_id IS NOT NULL;
