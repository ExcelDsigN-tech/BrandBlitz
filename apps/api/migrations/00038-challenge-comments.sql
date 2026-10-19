CREATE TABLE challenge_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_comments_challenge_cursor ON challenge_comments (challenge_id, created_at DESC, id DESC);
CREATE INDEX idx_comments_user_recent ON challenge_comments (user_id, created_at DESC);

CREATE FUNCTION remove_soft_deleted_challenge_comments() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM challenge_comments WHERE challenge_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER challenge_comments_soft_delete
  AFTER UPDATE OF deleted_at ON challenges
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION remove_soft_deleted_challenge_comments();
