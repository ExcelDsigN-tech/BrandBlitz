-- Migration: Brand email digest preferences (Issue #1017)
-- Add scheduled email digest of challenge performance for brands

CREATE TABLE brand_digest_preferences (
  brand_id UUID PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_brand_digest_preferences_enabled_frequency 
  ON brand_digest_preferences(enabled, frequency) 
  WHERE enabled = TRUE;

COMMENT ON TABLE brand_digest_preferences IS 'Brand opt-in preferences for scheduled email digests of challenge performance';
COMMENT ON COLUMN brand_digest_preferences.enabled IS 'Whether the brand has opted into receiving email digests';
COMMENT ON COLUMN brand_digest_preferences.frequency IS 'How often to send the digest: daily, weekly, or monthly';
COMMENT ON COLUMN brand_digest_preferences.last_sent_at IS 'Timestamp of last digest sent to prevent double-sending on retry';
