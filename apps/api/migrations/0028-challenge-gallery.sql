-- Migration 0028: public gallery opt-in for challenges
-- Brands can opt a completed/settled challenge into the public gallery so that
-- other brands can discover and clone it as a starting template.

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS is_gallery_template  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gallery_opted_in_at  TIMESTAMPTZ;

-- Partial index: fast lookup of opted-in challenges that have completed
CREATE INDEX IF NOT EXISTS idx_challenges_gallery
  ON challenges (pool_amount_stroops DESC, id DESC)
  WHERE is_gallery_template = TRUE
    AND deleted_at IS NULL
    AND status IN ('settled', 'ended', 'payout_failed');
