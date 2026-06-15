-- ============================================================
-- Cloud9 OS — Migration 006: Picks + Returns
-- Picks: count of completed picks (operational throughput).
-- Returns: returns raised in Helm (important to watch).
-- Field mapping is best-guess until confirmed against a real Helm webhook fire.
-- ============================================================

CREATE TABLE pick_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helm_pick_id  VARCHAR(64),
  customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
  helm_client_id VARCHAR(64),
  item_count    INTEGER NOT NULL DEFAULT 0,
  picked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_pick_events_helm ON pick_events(helm_pick_id) WHERE helm_pick_id IS NOT NULL;
CREATE INDEX idx_pick_events_picked ON pick_events(picked_at DESC);

CREATE TABLE returns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helm_return_id VARCHAR(64),
  customer_id    UUID REFERENCES customers(id) ON DELETE SET NULL,
  helm_client_id VARCHAR(64),
  reference      VARCHAR(160),
  order_ref      VARCHAR(160),
  status         VARCHAR(60),
  reason         VARCHAR(255),
  item_count     INTEGER NOT NULL DEFAULT 0,
  raw_payload    JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_returns_helm ON returns(helm_return_id) WHERE helm_return_id IS NOT NULL;
CREATE INDEX idx_returns_customer ON returns(customer_id, created_at DESC);
CREATE TRIGGER trg_returns_updated_at BEFORE UPDATE ON returns
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
