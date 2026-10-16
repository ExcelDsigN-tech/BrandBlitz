-- Configurable league scoring, challenge experiments/tiers, and user moderation.

CREATE TABLE IF NOT EXISTS leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scoring_weights JSONB NOT NULL DEFAULT '{"speed":0.4,"accuracy":0.4,"streak":0.2}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leagues_scoring_weights_shape CHECK (
    jsonb_typeof(scoring_weights) = 'object'
    AND (scoring_weights->>'speed')::numeric BETWEEN 0 AND 1
    AND (scoring_weights->>'accuracy')::numeric BETWEEN 0 AND 1
    AND (scoring_weights->>'streak')::numeric BETWEEN 0 AND 1
    AND ((scoring_weights->>'speed')::numeric + (scoring_weights->>'accuracy')::numeric + (scoring_weights->>'streak')::numeric) BETWEEN 0.99 AND 1.01
  )
);

ALTER TABLE league_assignments ADD COLUMN IF NOT EXISTS league_id UUID REFERENCES leagues(id) ON DELETE SET NULL;
ALTER TABLE league_assignments ADD COLUMN IF NOT EXISTS scoring_weights JSONB;

CREATE TABLE IF NOT EXISTS challenge_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  question_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'promoted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS challenge_variants_challenge_name_idx ON challenge_variants(challenge_id, name);

CREATE TABLE IF NOT EXISTS challenge_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  entry_fee_stroops NUMERIC(30,0) NOT NULL DEFAULT 0 CHECK (entry_fee_stroops >= 0),
  prize_pool_stroops NUMERIC(30,0) NOT NULL CHECK (prize_pool_stroops > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS challenge_tiers_challenge_name_idx ON challenge_tiers(challenge_id, name);

ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES challenge_variants(id) ON DELETE SET NULL;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS tier_id UUID REFERENCES challenge_tiers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_no_self CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_reports_no_self CHECK (reporter_id <> reported_id)
);
CREATE INDEX IF NOT EXISTS user_reports_status_created_idx ON user_reports(status, created_at DESC);

CREATE INDEX IF NOT EXISTS game_sessions_variant_idx ON game_sessions(variant_id);
CREATE INDEX IF NOT EXISTS game_sessions_tier_idx ON game_sessions(tier_id);

INSERT INTO leagues (brand_id, name, scoring_weights)
VALUES
  (NULL, 'bronze', '{"speed":0.4,"accuracy":0.4,"streak":0.2}'::jsonb),
  (NULL, 'silver', '{"speed":0.4,"accuracy":0.4,"streak":0.2}'::jsonb),
  (NULL, 'gold', '{"speed":0.4,"accuracy":0.4,"streak":0.2}'::jsonb)
ON CONFLICT DO NOTHING;