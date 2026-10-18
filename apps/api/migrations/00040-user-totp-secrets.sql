-- Migration: 00040-user-totp-secrets
-- Adds opt-in TOTP two-factor authentication for user accounts.
-- See issue #1015.

CREATE TABLE user_totp_secrets (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Encrypted TOTP secret (AES-GCM via pgcrypto, key = SESSION_INTEGRITY_KEY).
  -- Stored as a base32 string encrypted with pgp_sym_encrypt.
  encrypted_secret  TEXT    NOT NULL,
  -- Whether enrollment has been confirmed by the user submitting a valid code.
  confirmed         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_totp_secrets_user_unique UNIQUE (user_id)
);

CREATE INDEX idx_user_totp_secrets_user_id ON user_totp_secrets (user_id);

CREATE TABLE user_totp_backup_codes (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- bcrypt hash of the plaintext backup code (shown once to the user).
  code_hash   TEXT    NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_totp_backup_codes_user_id ON user_totp_backup_codes (user_id);
