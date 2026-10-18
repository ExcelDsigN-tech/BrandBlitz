-- Down migration: 00040-user-totp-secrets
DROP TABLE IF EXISTS user_totp_backup_codes;
DROP TABLE IF EXISTS user_totp_secrets;
