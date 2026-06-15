-- ============================================================
-- Cloud9 OS — Migration 004: Webhook capture log
-- Stores the raw body of every inbound webhook so we can inspect the real
-- Helm payload shapes (especially parcel structure + fulfilment client id)
-- and lock the parsers. Capped/pruned to recent rows.
-- ============================================================

CREATE TABLE webhook_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint    VARCHAR(80) NOT NULL,   -- e.g. order-created
  authorized  BOOLEAN NOT NULL DEFAULT true,
  payload     JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_webhook_log_recent ON webhook_log(received_at DESC);
