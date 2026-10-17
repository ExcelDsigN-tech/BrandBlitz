-- Migration 00031: brand_members
-- Multi-admin support per brand with role-based permissions (owner, editor, viewer) (#1007).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'brand_member_role') THEN
    CREATE TYPE brand_member_role AS ENUM ('owner', 'editor', 'viewer');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS brand_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role brand_member_role NOT NULL DEFAULT 'viewer',
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT brand_members_brand_email_unique UNIQUE (brand_id, email)
);

CREATE INDEX IF NOT EXISTS idx_brand_members_brand_id ON brand_members(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_members_user_id ON brand_members(user_id);
CREATE INDEX IF NOT EXISTS idx_brand_members_email ON brand_members(email);

-- Backfill brand owners into brand_members
INSERT INTO brand_members (brand_id, user_id, email, role, invited_by)
SELECT b.id, b.owner_user_id, u.email, 'owner'::brand_member_role, b.owner_user_id
FROM brands b
JOIN users u ON u.id = b.owner_user_id
ON CONFLICT (brand_id, email) DO NOTHING;
