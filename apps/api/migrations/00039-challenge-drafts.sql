ALTER TABLE challenges DROP CONSTRAINT challenges_status_check;
ALTER TABLE challenges ADD CONSTRAINT challenges_status_check CHECK (
  status IN ('draft', 'pending_deposit', 'active', 'ended', 'settled', 'payout_failed', 'cancelled', 'refunded')
);
ALTER TABLE challenges ALTER COLUMN starts_at DROP NOT NULL;
ALTER TABLE challenges ADD CONSTRAINT challenges_draft_dates CHECK (
  status = 'draft' OR starts_at IS NOT NULL
);
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_pool_amount_positive;
ALTER TABLE challenges ADD CONSTRAINT challenges_pool_amount_positive CHECK (
  status IN ('draft', 'pending_deposit', 'cancelled', 'refunded') OR pool_amount_stroops > 0
);
