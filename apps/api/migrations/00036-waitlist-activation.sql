-- Migration 00036: waitlist activation
-- Track when a waitlist entry is let in so the API can report live queue
-- position and estimate wait time from recent activation throughput (#1046).

ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- Position counts pending entries ahead of you in join order.
CREATE INDEX IF NOT EXISTS idx_waitlist_pending_created_at
  ON waitlist (created_at)
  WHERE activated_at IS NULL;

-- Throughput counts activations in a recent window.
CREATE INDEX IF NOT EXISTS idx_waitlist_activated_at
  ON waitlist (activated_at)
  WHERE activated_at IS NOT NULL;
