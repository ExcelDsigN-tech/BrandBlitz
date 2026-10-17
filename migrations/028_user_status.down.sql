-- Migration 028 DOWN: Remove user suspension status support

DROP INDEX IF EXISTS idx_users_status;

ALTER TABLE users
  DROP COLUMN status,
  DROP COLUMN suspension_reason,
  DROP COLUMN suspended_at,
  DROP COLUMN suspended_by;
