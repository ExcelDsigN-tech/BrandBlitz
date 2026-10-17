-- Drop old table if it exists since the schema changed
DROP TABLE IF EXISTS session_round_scores;

-- Create session_round_scores table
CREATE TABLE IF NOT EXISTS session_round_scores (
  session_id       UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  round            INTEGER NOT NULL CHECK (round IN (1, 2, 3)),
  answer           TEXT,
  score            INTEGER NOT NULL CHECK (score >= 0),
  reaction_time_ms INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, round)
);

CREATE INDEX IF NOT EXISTS idx_round_scores_session ON session_round_scores (session_id);

-- Backfill from game_sessions
INSERT INTO session_round_scores (session_id, round, answer, score, reaction_time_ms)
SELECT id, 1, round_1_answer, round_1_score, round_1_reaction_ms
FROM game_sessions
WHERE round_1_answer IS NOT NULL OR round_1_score > 0
ON CONFLICT (session_id, round) DO NOTHING;

INSERT INTO session_round_scores (session_id, round, answer, score, reaction_time_ms)
SELECT id, 2, round_2_answer, round_2_score, round_2_reaction_ms
FROM game_sessions
WHERE round_2_answer IS NOT NULL OR round_2_score > 0
ON CONFLICT (session_id, round) DO NOTHING;

INSERT INTO session_round_scores (session_id, round, answer, score, reaction_time_ms)
SELECT id, 3, round_3_answer, round_3_score, round_3_reaction_ms
FROM game_sessions
WHERE round_3_answer IS NOT NULL OR round_3_score > 0
ON CONFLICT (session_id, round) DO NOTHING;

-- Note: We are leaving the old columns (round_1_answer, etc.) intact for sunsetting later.
