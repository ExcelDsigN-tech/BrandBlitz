CREATE INDEX idx_challenges_retention_brand ON challenges (brand_id, id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_sessions_retention_challenge ON game_sessions (challenge_id, user_id, created_at)
  WHERE flagged = FALSE;
