-- ─── Migration 183 — Courier queries table ───────────────────────────────────
--
-- Tracks disputes and queries raised with carriers (DPD, DHL, etc.) arising
-- from reconciliation discrepancies. Covers two scenarios:
--
--   1. Genuine overbilling — carrier charged for parcels/services not provided.
--      Expected outcome: carrier issues a credit note.
--
--   2. Consolidation mismatch — carrier grouped multiple OMS shipments under
--      one consignment; system couldn't auto-match. Manual link required.
--
-- Status workflow:
--   open → raised → acknowledged → credited | rejected | written_off
--
-- A query is linked to a reconciliation_line (the flagged line that triggered it)
-- and optionally to multiple charge_ids (the OMS charges involved).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS courier_queries (
  id                      SERIAL PRIMARY KEY,

  -- Source context
  run_id                  INTEGER      REFERENCES reconciliation_runs(id) ON DELETE SET NULL,
  reconciliation_line_id  INTEGER      REFERENCES reconciliation_lines(id) ON DELETE SET NULL,
  carrier_id              INTEGER      NOT NULL REFERENCES couriers(id),

  -- Invoice context
  invoice_ref             VARCHAR(100),
  tracking_number         VARCHAR(100),

  -- Query classification
  query_type              VARCHAR(50)  NOT NULL,
  -- 'parcel_count_overbill'  — carrier invoiced more parcels than booked
  -- 'consolidation_mismatch' — multiple OMS shipments consolidated by carrier
  -- 'rate_dispute'           — carrier charged wrong rate
  -- 'unrecognised_charge'    — charge not matching any OMS shipment
  -- 'other'                  — manually classified

  -- Financial detail
  carrier_charged         NUMERIC(10,4),   -- what carrier invoiced
  expected_charged        NUMERIC(10,4),   -- what we expected to pay
  disputed_amount         NUMERIC(10,4)    GENERATED ALWAYS AS
                            (COALESCE(carrier_charged, 0) - COALESCE(expected_charged, 0))
                            STORED,

  -- Narrative
  details                 TEXT,

  -- Carrier-side tracking
  carrier_reference       VARCHAR(100),    -- DPD/carrier's own case/query number

  -- Status
  status                  VARCHAR(30)  NOT NULL DEFAULT 'open',
  -- open | raised | acknowledged | credited | rejected | written_off

  -- Resolution
  credit_amount           NUMERIC(10,4),   -- amount credited back by carrier
  resolution_notes        TEXT,
  resolved_at             TIMESTAMPTZ,

  -- Audit
  created_by              UUID         REFERENCES staff(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  raised_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS courier_queries_run_id_idx     ON courier_queries(run_id);
CREATE INDEX IF NOT EXISTS courier_queries_carrier_id_idx ON courier_queries(carrier_id);
CREATE INDEX IF NOT EXISTS courier_queries_status_idx     ON courier_queries(status);
CREATE INDEX IF NOT EXISTS courier_queries_tracking_idx   ON courier_queries(tracking_number);

-- Linked OMS charges (junction — one query may span multiple consolidated charges)
CREATE TABLE IF NOT EXISTS courier_query_charges (
  query_id    INTEGER NOT NULL REFERENCES courier_queries(id) ON DELETE CASCADE,
  charge_id   UUID    NOT NULL REFERENCES charges(id)         ON DELETE CASCADE,
  PRIMARY KEY (query_id, charge_id)
);

DO $$ BEGIN
  RAISE NOTICE 'Migration 183: courier_queries and courier_query_charges tables created';
END $$;
