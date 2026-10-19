-- Migration 0030: challenge_ratings
-- Participant-submitted difficulty ratings (1-5) for a completed challenge.
-- At most one rating per user per challenge. Offered as brand feedback so
-- brands can tune future challenge design (issue #999).

CREATE TABLE challenge_ratings (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID        NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  difficulty   INTEGER     NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (challenge_id, user_id)
);

CREATE INDEX idx_challenge_ratings_challenge_id ON challenge_ratings (challenge_id);
CREATE INDEX idx_challenge_ratings_user_id      ON challenge_ratings (user_id);
