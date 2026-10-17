-- Rollback migration 00030
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS fraud_score_override_non_negative,
  DROP COLUMN IF EXISTS fraud_score_override_at,
  DROP COLUMN IF EXISTS fraud_score_override_by,
  DROP COLUMN IF EXISTS fraud_score_override_reason,
  DROP COLUMN IF EXISTS fraud_score_override;
