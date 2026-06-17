-- ──────────────────────────────────────────────────────────────────
-- 295 — Moov OS ticket numbers  (MOOV-001, MOOV-002 … MOOV-1000+)
-- ──────────────────────────────────────────────────────────────────

-- 1. Sequence
CREATE SEQUENCE IF NOT EXISTS moov_ticket_seq START 1;

-- 2. Column
ALTER TABLE queries
  ADD COLUMN IF NOT EXISTS ticket_number TEXT;

-- 3. Back-fill existing rows in creation order using a PL/pgSQL loop
--    (avoids LPAD type-cast ambiguity in plain SQL)
DO $$
DECLARE
  r       RECORD;
  counter INTEGER := 1;
BEGIN
  FOR r IN
    SELECT id FROM queries
    WHERE  ticket_number IS NULL
    ORDER  BY created_at, id
  LOOP
    UPDATE queries
    SET    ticket_number = 'MOOV-' || LPAD(counter::TEXT, 3, '0')
    WHERE  id = r.id;
    counter := counter + 1;
  END LOOP;

  -- Advance the sequence past the rows we just filled
  IF counter > 1 THEN
    PERFORM setval('moov_ticket_seq', counter - 1, true);
  END IF;
END;
$$;

-- 4. Trigger function — auto-assigns on every new INSERT
CREATE OR REPLACE FUNCTION assign_moov_ticket_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  seq_val BIGINT;
BEGIN
  IF NEW.ticket_number IS NULL THEN
    seq_val           := nextval('moov_ticket_seq');
    NEW.ticket_number := 'MOOV-' || LPAD(seq_val::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_moov_ticket_number ON queries;
CREATE TRIGGER trg_moov_ticket_number
  BEFORE INSERT ON queries
  FOR EACH ROW EXECUTE FUNCTION assign_moov_ticket_number();

-- 5. Index for fast search
CREATE INDEX IF NOT EXISTS idx_queries_ticket_number ON queries (ticket_number);
