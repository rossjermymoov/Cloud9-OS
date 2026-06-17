-- ============================================================
-- Cloud9 OS — Queries port compatibility stubs
-- The Moov queries/claims schema references a few Moov billing/courier tables
-- that Cloud9 doesn't have. We create minimal stubs so the ported migrations
-- apply cleanly (the FKs are all nullable / ON DELETE SET NULL, except the
-- courier_charges link which Cloud9 won't populate yet). Column ID types match
-- Moov's originals so the foreign keys line up. Runs before the q058+ migrations.
-- ============================================================

CREATE TABLE IF NOT EXISTS couriers (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120),
  code        VARCHAR(60),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS reconciliation_runs  (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS reconciliation_lines (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS charges              (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
