-- Refuse to roll back while drafts exist rather than discarding their configuration.
ALTER TABLE challenges DROP CONSTRAINT challenges_draft_dates;
ALTER TABLE challenges ALTER COLUMN starts_at SET NOT NULL;
ALTER TABLE challenges DROP CONSTRAINT challenges_status_check;
ALTER TABLE challenges ADD CONSTRAINT challenges_status_check CHECK (
  status IN ('pending_deposit', 'active', 'ended', 'settled', 'payout_failed', 'cancelled', 'refunded')
);
ALTER TABLE challenges DROP CONSTRAINT challenges_pool_amount_positive;
ALTER TABLE challenges ADD CONSTRAINT challenges_pool_amount_positive CHECK (
  status IN ('pending_deposit', 'cancelled', 'refunded') OR pool_amount_stroops > 0
);
