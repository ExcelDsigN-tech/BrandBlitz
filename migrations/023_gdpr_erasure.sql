-- Migration 023: GDPR right-to-erasure request tracking table
-- Records pending / executed / cancelled erasure requests.
-- The actual anonymisation is performed by the gdpr-erasure BullMQ worker
-- after the 30-day grace period elapses.

CREATE TABLE gdpr_erasure_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  execute_at   TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  executed_at  TIMESTAMPTZ,
  admin_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gdpr_erasure_user_id ON gdpr_erasure_requests (user_id);

CREATE TRIGGER gdpr_erasure_requests_updated_at
  BEFORE UPDATE ON gdpr_erasure_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
