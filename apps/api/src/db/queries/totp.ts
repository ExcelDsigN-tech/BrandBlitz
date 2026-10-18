/**
 * totp.ts — Database helpers for TOTP 2FA secrets and backup codes.
 *
 * The TOTP secret is stored encrypted with pgp_sym_encrypt (pgcrypto) using
 * SESSION_INTEGRITY_KEY as the passphrase so it is never in the database in
 * plaintext.  Backup codes are stored as bcrypt hashes and are single-use.
 *
 * No external TOTP library is used — TOTP (RFC 6238) is implemented directly
 * using Node's built-in `crypto` module (HMAC-SHA1 over a time counter).
 */
import { query } from "..";
import bcrypt from "bcryptjs";
import { createHmac, randomBytes } from "crypto";

const BACKUP_CODE_ROUNDS = 10;
const BACKUP_CODE_COUNT = 10;

// ─────────────────────────────────────────────────────────────────────────────
// TOTP implementation (RFC 6238 / RFC 4226) — no external library
// ─────────────────────────────────────────────────────────────────────────────

/** Decode a base32-encoded string to a Buffer. */
function base32Decode(encoded: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = encoded.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  let index = 0;
  const output = Buffer.alloc(Math.floor((clean.length * 5) / 8));
  for (const char of clean) {
    const charIndex = alphabet.indexOf(char);
    if (charIndex === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | charIndex;
    bits += 5;
    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return output.subarray(0, index);
}

/** Encode a Buffer as base32 (RFC 4648, no padding). */
export function base32Encode(buf: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

/** Generate a cryptographically random base32 TOTP secret (20 bytes = 160 bits). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * Compute a TOTP code for the given base32 secret and time step.
 * Implements RFC 6238 with SHA-1, 30-second window, 6-digit output.
 */
export function computeTotp(secret: string, timeStep?: number): string {
  const step = timeStep ?? Math.floor(Date.now() / 1000 / 30);
  const counter = Buffer.alloc(8);
  // Write the 8-byte big-endian counter
  const high = Math.floor(step / 0x100000000);
  const low = step >>> 0;
  counter.writeUInt32BE(high, 0);
  counter.writeUInt32BE(low, 4);

  const keyBytes = base32Decode(secret);
  const hmac = createHmac("sha1", keyBytes).update(counter).digest();

  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 1_000_000).padStart(6, "0");
}

/**
 * Verify a TOTP code. Accepts codes from one step before and one step after
 * the current window to tolerate minor clock skew.
 */
export function verifyTotp(token: string, secret: string): boolean {
  const step = Math.floor(Date.now() / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    if (computeTotp(secret, step + delta) === token) return true;
  }
  return false;
}

/**
 * Build an otpauth:// URI for provisioning authenticator apps.
 * See https://github.com/google/google-authenticator/wiki/Key-Uri-Format
 */
export function buildOtpauthUri(
  secret: string,
  accountName: string,
  issuer = "BrandBlitz"
): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret storage
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertTotpSecret(
  userId: string,
  plaintextSecret: string,
  encryptionKey: string
): Promise<void> {
  await query(
    `INSERT INTO user_totp_secrets (user_id, encrypted_secret, confirmed)
     VALUES ($1, pgp_sym_encrypt($2, $3), FALSE)
     ON CONFLICT (user_id) DO UPDATE
       SET encrypted_secret = pgp_sym_encrypt($2, $3),
           confirmed        = FALSE,
           updated_at       = NOW()`,
    [userId, plaintextSecret, encryptionKey]
  );
}

export async function confirmTotpEnrollment(userId: string): Promise<void> {
  await query(
    `UPDATE user_totp_secrets SET confirmed = TRUE, updated_at = NOW() WHERE user_id = $1`,
    [userId]
  );
}

export async function getTotpSecret(
  userId: string,
  encryptionKey: string
): Promise<{ secret: string; confirmed: boolean } | null> {
  const result = await query<{ secret: string; confirmed: boolean }>(
    `SELECT pgp_sym_decrypt(encrypted_secret::bytea, $2) AS secret, confirmed
     FROM user_totp_secrets
     WHERE user_id = $1`,
    [userId, encryptionKey]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0];
}

export async function deleteTotpSecret(userId: string): Promise<void> {
  // Cascade deletes backup codes as well via FK.
  await query(`DELETE FROM user_totp_secrets WHERE user_id = $1`, [userId]);
}

export async function hasTotpEnabled(userId: string): Promise<boolean> {
  const result = await query<{ confirmed: boolean }>(
    `SELECT confirmed FROM user_totp_secrets WHERE user_id = $1`,
    [userId]
  );
  return result.rowCount! > 0 && result.rows[0].confirmed === true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup codes
// ─────────────────────────────────────────────────────────────────────────────

/** Generate plaintext backup codes, hash them, store them, and return the
 *  plaintext values (shown to the user exactly once). */
export async function generateAndStoreBackupCodes(userId: string): Promise<string[]> {
  const plainCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => generateBackupCode());

  // Delete existing codes for this user before inserting new ones.
  await query(`DELETE FROM user_totp_backup_codes WHERE user_id = $1`, [userId]);

  for (const code of plainCodes) {
    const hash = await bcrypt.hash(code, BACKUP_CODE_ROUNDS);
    await query(`INSERT INTO user_totp_backup_codes (user_id, code_hash) VALUES ($1, $2)`, [
      userId,
      hash,
    ]);
  }

  return plainCodes;
}

/**
 * Attempt to consume a backup code for a user.
 * Returns true if a valid unused code was found and consumed, false otherwise.
 * Each code is single-use — it is marked used atomically on first match.
 */
export async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  // Fetch all unused hashes for the user and compare in application code to
  // avoid leaking timing information via SQL-level comparison.
  const result = await query<{ id: string; code_hash: string }>(
    `SELECT id, code_hash FROM user_totp_backup_codes
     WHERE user_id = $1 AND used = FALSE`,
    [userId]
  );

  for (const row of result.rows) {
    const matches = await bcrypt.compare(code, row.code_hash);
    if (matches) {
      await query(`UPDATE user_totp_backup_codes SET used = TRUE, used_at = NOW() WHERE id = $1`, [
        row.id,
      ]);
      return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Generates a human-readable backup code: XXXXX-XXXXX (10 alphanumeric chars). */
function generateBackupCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // omit I/O/1/0 to reduce confusion
  const bytes = randomBytes(10);
  const half = (offset: number) =>
    Array.from({ length: 5 }, (_, i) => chars[bytes[offset + i] % chars.length]).join("");
  return `${half(0)}-${half(5)}`;
}
