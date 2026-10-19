-- Migration 00035: Add payout_schedule to challenges
-- Allows brands to select between instant payout on settlement and batched daily payout.
-- Existing challenges default to 'instant' to preserve current behavior.

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS payout_schedule TEXT NOT NULL DEFAULT 'instant'
  CHECK (payout_schedule IN ('instant', 'batched'));

ALTER TABLE challenges_archive
  ADD COLUMN IF NOT EXISTS payout_schedule TEXT NOT NULL DEFAULT 'instant';
