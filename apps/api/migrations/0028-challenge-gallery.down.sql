-- Rollback migration 0028
DROP INDEX IF EXISTS idx_challenges_gallery;
ALTER TABLE challenges
  DROP COLUMN IF EXISTS gallery_opted_in_at,
  DROP COLUMN IF EXISTS is_gallery_template;
