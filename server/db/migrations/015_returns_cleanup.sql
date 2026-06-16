-- ============================================================
-- Cloud9 OS — Migration 015: clear malformed test returns
-- The first return-created handler choked on Helm's array payload and inserted
-- rows with a NULL helm_return_id and empty fields. A real return always has an
-- id, so these are safe to remove; correct returns re-arrive via the webhook.
-- ============================================================

DELETE FROM returns WHERE helm_return_id IS NULL;
