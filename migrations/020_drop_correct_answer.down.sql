-- Migration 020 DOWN: Restore the legacy correct_answer column.
--
-- This rollback is intentionally lossy: the original correct_answer values
-- were discarded by the forward migration and cannot be recovered. The
-- restored column is nullable so the rollback does not invent answer data.

ALTER TABLE challenge_questions
  ADD COLUMN IF NOT EXISTS correct_answer TEXT;
