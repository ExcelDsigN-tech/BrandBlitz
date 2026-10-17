-- Down migration 00032: brand_budget_threshold
DROP TABLE IF EXISTS brand_notifications CASCADE;
DROP INDEX IF EXISTS idx_brands_budget_threshold;

ALTER TABLE brands
  DROP COLUMN IF EXISTS budget_alert_sent_at,
  DROP COLUMN IF EXISTS budget_alert_sent,
  DROP COLUMN IF EXISTS budget_threshold;
