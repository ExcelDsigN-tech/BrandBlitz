-- Migration 00032: brand_budget_threshold
-- Adds configurable spend budget alerts for brands (#1003).

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS budget_threshold NUMERIC(14,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS budget_alert_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS budget_alert_sent_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_brands_budget_threshold ON brands(budget_threshold)
  WHERE budget_threshold IS NOT NULL AND deleted_at IS NULL;

-- Brand notifications for budget alerts and team events
CREATE TABLE IF NOT EXISTS brand_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  read_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brand_notifications_brand_id ON brand_notifications(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_notifications_user_id ON brand_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_brand_notifications_created_at ON brand_notifications(created_at DESC);
