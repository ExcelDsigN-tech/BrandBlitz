-- Migration 002 DOWN: Restore the legacy session end timestamp column.
--
-- This rollback is intentionally lossy: values removed when the forward
-- migration dropped challenge_ended_at cannot be recovered. The restored
-- column is therefore nullable; operators may backfill it from completed_at
-- when that is appropriate for their incident response.

ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS challenge_ended_at TIMESTAMPTZ;
