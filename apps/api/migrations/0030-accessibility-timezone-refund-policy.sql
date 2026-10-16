-- Persist user display preferences and challenge cancellation policy.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS accessibility_mode BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS vanity_slug TEXT;

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS refund_policy TEXT NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS refund_percentage NUMERIC(5, 2) NOT NULL DEFAULT 100;

ALTER TABLE challenges
  DROP CONSTRAINT IF EXISTS challenges_refund_policy_check;

ALTER TABLE challenges
  ADD CONSTRAINT challenges_refund_policy_check
  CHECK (
    refund_policy IN ('full', 'partial_percentage', 'none_after_start')
    AND refund_percentage >= 0
    AND refund_percentage <= 100
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_vanity_slug
  ON users (LOWER(vanity_slug))
  WHERE vanity_slug IS NOT NULL AND deleted_at IS NULL;
