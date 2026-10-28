-- Migration 00041: waitlist activation throughput index
-- GET /waitlist/:id/position estimates wait time from activations in a recent
-- window (#1046). 00036 already added activated_at and the pending-queue index.
CREATE INDEX IF NOT EXISTS idx_waitlist_activated_at
  ON waitlist (activated_at)
  WHERE activated_at IS NOT NULL;
