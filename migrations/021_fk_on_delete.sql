-- Migration 021: Fix ON DELETE behaviour for financial / fraud records
-- game_sessions.user_id  → SET NULL  (keep session history when user deleted)
-- payouts.user_id        → SET NULL  (keep payout records for regulatory compliance)
-- fraud_flags.user_id    → RESTRICT  (block hard-delete while fraud investigation open)

-- ── game_sessions ────────────────────────────────────────────────────────────
ALTER TABLE game_sessions
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE game_sessions
  DROP CONSTRAINT game_sessions_user_id_fkey;

ALTER TABLE game_sessions
  ADD CONSTRAINT game_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- ── payouts ──────────────────────────────────────────────────────────────────
ALTER TABLE payouts
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE payouts
  DROP CONSTRAINT payouts_user_id_fkey;

ALTER TABLE payouts
  ADD CONSTRAINT payouts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- ── fraud_flags ───────────────────────────────────────────────────────────────
ALTER TABLE fraud_flags
  DROP CONSTRAINT fraud_flags_user_id_fkey;

ALTER TABLE fraud_flags
  ADD CONSTRAINT fraud_flags_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
