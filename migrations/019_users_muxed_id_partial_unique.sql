ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_muxed_id_key;

DROP INDEX IF EXISTS users_muxed_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS users_muxed_id_unique
  ON users (muxed_id)
  WHERE muxed_id IS NOT NULL;
