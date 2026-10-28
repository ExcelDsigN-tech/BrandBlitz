DROP TABLE IF EXISTS push_subscriptions;

ALTER TABLE users
  DROP COLUMN IF EXISTS push_notifications_enabled;
