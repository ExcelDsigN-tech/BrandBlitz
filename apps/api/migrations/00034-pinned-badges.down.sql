-- Down migration 00034: pinned_badges
ALTER TABLE users
  DROP COLUMN IF EXISTS pinned_badges;
