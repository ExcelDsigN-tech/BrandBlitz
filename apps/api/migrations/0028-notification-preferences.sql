-- Notification preferences: per-user opt-in/opt-out for notification categories

CREATE TYPE notification_category AS ENUM (
  'payout',
  'badge',
  'streak',
  'referral'
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id                UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category          notification_category NOT NULL,
  enabled           BOOLEAN           NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, category)
);

-- Partial index for efficient preference lookups per user
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user
  ON notification_preferences(user_id)
  WHERE enabled = true;

-- Trigger to update updated_at on modification
CREATE OR REPLACE FUNCTION update_notification_preferences_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notification_preferences_update_timestamp
BEFORE UPDATE ON notification_preferences
FOR EACH ROW
EXECUTE FUNCTION update_notification_preferences_timestamp();

-- Seed default preferences for existing users (all enabled by default)
INSERT INTO notification_preferences (user_id, category, enabled)
SELECT DISTINCT u.id, 'payout', true
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM notification_preferences np WHERE np.user_id = u.id AND np.category = 'payout'
)
ON CONFLICT DO NOTHING;

INSERT INTO notification_preferences (user_id, category, enabled)
SELECT DISTINCT u.id, 'badge', true
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM notification_preferences np WHERE np.user_id = u.id AND np.category = 'badge'
)
ON CONFLICT DO NOTHING;

INSERT INTO notification_preferences (user_id, category, enabled)
SELECT DISTINCT u.id, 'streak', true
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM notification_preferences np WHERE np.user_id = u.id AND np.category = 'streak'
)
ON CONFLICT DO NOTHING;

INSERT INTO notification_preferences (user_id, category, enabled)
SELECT DISTINCT u.id, 'referral', true
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM notification_preferences np WHERE np.user_id = u.id AND np.category = 'referral'
)
ON CONFLICT DO NOTHING;
