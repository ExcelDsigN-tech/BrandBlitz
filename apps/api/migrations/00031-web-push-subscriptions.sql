-- Migration 0031: web push subscriptions (issue #1009)
--
-- Stores one row per browser/device subscription so the API can deliver
-- notifications through a push service when the user has no tab open.
-- Push delivery is toggled independently of in-app notifications via
-- users.push_notifications_enabled.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT        NOT NULL CHECK (length(endpoint) <= 2048),
  p256dh        TEXT        NOT NULL,
  auth          TEXT        NOT NULL,
  user_agent    TEXT,
  failure_count INTEGER     NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unq_push_subscriptions_user_endpoint UNIQUE (user_id, endpoint)
);

-- Fast lookup of every device belonging to a user during dispatch.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON push_subscriptions(user_id);

-- Supports periodic pruning of subscriptions that have repeatedly failed.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_failures
  ON push_subscriptions(failure_count)
  WHERE failure_count > 0;
