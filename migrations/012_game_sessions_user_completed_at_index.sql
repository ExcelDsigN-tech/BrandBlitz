-- Speeds up profile and "my sessions" lookups by user, newest completed first.
CREATE INDEX IF NOT EXISTS idx_game_sessions_user_id_completed_at
  ON game_sessions (user_id, completed_at DESC);
