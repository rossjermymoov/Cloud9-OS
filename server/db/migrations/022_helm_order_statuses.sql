-- ============================================================
-- Cloud9 OS — Migration 022: Helm order-status definitions
-- Helm sends a full status object on each order ({ id, status, dashboard, colour }).
-- We capture those here so the dashboard can render a KPI card for every status
-- Helm flags as visible on the dashboard (dashboard = true).
-- ============================================================

CREATE TABLE IF NOT EXISTS helm_order_statuses (
  status_id   INTEGER PRIMARY KEY,
  name        VARCHAR(120),
  dashboard   BOOLEAN NOT NULL DEFAULT false,   -- Helm's "visible on dashboard" flag
  colour      VARCHAR(40),
  text_colour VARCHAR(40),
  sort        INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
