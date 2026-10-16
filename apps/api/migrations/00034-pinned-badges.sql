-- Migration 00034: pinned_badges
-- Let users pin favorite badges to their public profile (#1001).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pinned_badges TEXT[] NOT NULL DEFAULT '{}';
