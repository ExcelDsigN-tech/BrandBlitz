-- Runtime-tunable config table
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER app_config_updated_at
  BEFORE UPDATE ON app_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed default anti-cheat thresholds (no-op if already present)
INSERT INTO app_config (key, value) VALUES
  ('anti_cheat.thresholds', '{"min_human_reaction_ms": 150, "max_human_reaction_ms": 30000}')
ON CONFLICT (key) DO NOTHING;

-- Append-only audit trail for admin config changes
CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_key TEXT,
  before     JSONB,
  after      JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id   ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity     ON audit_log (entity, entity_key);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
