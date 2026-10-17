-- Migration 00030: fraud_score_override
-- Lets an admin manually override a user's computed fraud score, with a
-- required reason, from the admin fraud page (#1010). NULL means "no
-- override" -- the score stays the live COUNT(fraud_flags) computation.

ALTER TABLE users
  ADD COLUMN fraud_score_override INT,
  ADD COLUMN fraud_score_override_reason TEXT,
  ADD COLUMN fraud_score_override_by UUID REFERENCES users(id),
  ADD COLUMN fraud_score_override_at TIMESTAMPTZ;

ALTER TABLE users
  ADD CONSTRAINT fraud_score_override_non_negative
  CHECK (fraud_score_override IS NULL OR fraud_score_override >= 0);
