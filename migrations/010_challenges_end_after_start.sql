-- Backfill any rows where ends_at is set but is not after starts_at
UPDATE challenges
SET ends_at = starts_at + INTERVAL '72 hours'
WHERE ends_at IS NOT NULL AND ends_at <= starts_at;

-- Enforce that a non-null ends_at must be strictly after starts_at
ALTER TABLE challenges
  ADD CONSTRAINT challenges_ends_after_starts
  CHECK (ends_at IS NULL OR ends_at > starts_at);
