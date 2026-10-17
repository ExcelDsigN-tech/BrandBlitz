-- Rollback Migration 00035: Remove payout_schedule from challenges

ALTER TABLE challenges
  DROP COLUMN IF EXISTS payout_schedule;

ALTER TABLE challenges_archive
  DROP COLUMN IF EXISTS payout_schedule;
