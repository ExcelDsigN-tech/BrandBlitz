-- Migration 029: Challenge reminders, user notification type expansion, and personal API keys

-- 1. Support challenge reminder and rank overtaken notification types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'challenge_reminder' AND enumtypid = 'notification_type'::regtype) THEN
    ALTER TYPE notification_type ADD VALUE 'challenge_reminder';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'rank_overtaken' AND enumtypid = 'notification_type'::regtype) THEN
    ALTER TYPE notification_type ADD VALUE 'rank_overtaken';
  END IF;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- 2. Challenge reminders table
CREATE TABLE IF NOT EXISTS challenge_reminders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id        UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  lead_time_minutes   INT NOT NULL DEFAULT 15,
  scheduled_for       TIMESTAMPTZ NOT NULL,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unq_challenge_email_reminder UNIQUE (challenge_id, email)
);

CREATE INDEX IF NOT EXISTS idx_challenge_reminders_dispatch
  ON challenge_reminders (challenge_id, sent_at);

-- 3. Personal API keys table (read-only programmatic access)
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  scopes       TEXT[] NOT NULL DEFAULT ARRAY['read:stats']::TEXT[],
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id
  ON api_keys(user_id);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash
  ON api_keys(key_hash) WHERE revoked_at IS NULL;
