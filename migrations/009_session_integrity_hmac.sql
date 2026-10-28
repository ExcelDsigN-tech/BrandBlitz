-- Add integrity HMAC column to game_sessions for tamper detection.
-- The HMAC covers (session_id, total_score, completed_at) keyed by SESSION_INTEGRITY_KEY.
-- Payout job verifies this before broadcasting Stellar transactions.
ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS integrity_hmac TEXT;
