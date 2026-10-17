-- Early access is separate from account suspension: redeeming an invite must
-- never reactivate a suspended account.
ALTER TABLE waitlist
  ADD COLUMN status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active')),
  ADD COLUMN activated_at TIMESTAMPTZ;

CREATE TABLE invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  max_uses INTEGER CHECK (max_uses > 0),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (max_uses IS NULL OR use_count <= max_uses)
);
CREATE INDEX idx_invite_codes_brand ON invite_codes (brand_id, created_at DESC, id DESC);

CREATE TABLE invite_code_redemptions (
  invite_code_id UUID NOT NULL REFERENCES invite_codes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (invite_code_id, user_id)
);
CREATE INDEX idx_invite_redemptions_user ON invite_code_redemptions (user_id);
CREATE INDEX idx_waitlist_waiting ON waitlist (created_at, id) WHERE status = 'waiting';
