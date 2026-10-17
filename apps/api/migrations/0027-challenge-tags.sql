-- Migration 0027: challenge_tags and challenge_tag_map
-- Adds an admin-curated tag system for challenges with many-to-many join.

CREATE TABLE challenge_tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  slug       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_challenge_tags_slug ON challenge_tags (slug);

CREATE TABLE challenge_tag_map (
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  tag_id       UUID NOT NULL REFERENCES challenge_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (challenge_id, tag_id)
);

CREATE INDEX idx_challenge_tag_map_tag_id       ON challenge_tag_map (tag_id);
CREATE INDEX idx_challenge_tag_map_challenge_id ON challenge_tag_map (challenge_id);

-- Seed a small admin-curated starter set
INSERT INTO challenge_tags (name, slug) VALUES
  ('Quiz',      'quiz'),
  ('Trivia',    'trivia'),
  ('Brand',     'brand'),
  ('Product',   'product'),
  ('Tagline',   'tagline'),
  ('Logo',      'logo');
