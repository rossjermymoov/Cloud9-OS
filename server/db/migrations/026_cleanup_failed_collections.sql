-- ============================================================
-- Cloud9 OS — Migration 026: cleanup failed collections
-- Remove failed/incomplete booking attempts from early testing.
-- ============================================================

DELETE FROM collections WHERE status = 'failed' OR prn IS NULL;
