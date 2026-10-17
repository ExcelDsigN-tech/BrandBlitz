-- Down migration 00036: waitlist activation
DROP INDEX IF EXISTS idx_waitlist_activated_at;
DROP INDEX IF EXISTS idx_waitlist_pending_created_at;
ALTER TABLE waitlist
  DROP COLUMN IF EXISTS activated_at;
