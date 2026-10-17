-- Migration 0029: scheduled_config_changes
-- Stores config changes that should be applied at a future time.

CREATE TABLE scheduled_config_changes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key   TEXT        NOT NULL,
  value        JSONB       NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'applied', 'cancelled')),
  created_by   UUID        NOT NULL REFERENCES users(id),
  applied_at   TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID        REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scc_pending ON scheduled_config_changes (effective_at ASC)
  WHERE status = 'pending';

CREATE INDEX idx_scc_config_key ON scheduled_config_changes (config_key, status);
