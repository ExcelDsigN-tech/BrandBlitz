/**
 * auth.2fa.ts — TOTP two-factor authentication endpoints.
 *
 * Endpoints:
 *   GET    /auth/2fa/status                   — whether 2FA is enabled
 *   POST   /auth/2fa/enroll                   — begin enrollment (otpauth URI + QR URL)
 *   POST   /auth/2fa/confirm                  — confirm enrollment with first valid code
 *   POST   /auth/2fa/verify                   — verify TOTP code during login
 *   DELETE /auth/2fa/disenroll                — remove 2FA (requires valid code)
 *   POST   /auth/2fa/regenerate-backup-codes  — replace all backup codes
 *
 * The login flow (auth.ts POST /google/callback) checks whether the user has
 * confirmed 2FA enabled and, if so, returns a short-lived `pendingTotpToken`
 * instead of full credentials.  The client then calls POST /auth/2fa/verify
 * with that token + the TOTP code to receive the real access/refresh pair.
 *
 * No external dependencies beyond what is already in the project:
 *   - TOTP logic: built-in `crypto` (RFC 6238/4226 — see db/queries/totp.ts)
 *   - QR code: otpauth:// URI returned to the client; the client renders the
 *     QR code or the UI can hit the qrserver.com public API with the URI.
 *
 * Closes #1015
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { authLimiter } from "../middleware/rate-limit";
import { createError } from "../middleware/error";
import { findUserById } from "../db/queries/users";
import {
  generateTotpSecret,
  buildOtpauthUri,
  verifyTotp,
  upsertTotpSecret,
  confirmTotpEnrollment,
  getTotpSecret,
  deleteTotpSecret,
  hasTotpEnabled,
  generateAndStoreBackupCodes,
  consumeBackupCode,
} from "../db/queries/totp";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  registerRefreshJti,
} from "../lib/tokens";
import { query } from "../db";
import jwt from "jsonwebtoken";
import { config } from "../lib/config";
import { randomUUID } from "crypto";

const router = Router();

/** Derive the symmetric encryption key for TOTP secrets at rest.
 *  Uses SESSION_INTEGRITY_KEY when set, falls back to JWT_SECRET. */
function encryptionKey(): string {
  return config.SESSION_INTEGRITY_KEY ?? config.JWT_SECRET;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending-TOTP token
// A short-lived JWT issued after primary auth when 2FA is required.
// The client exchanges it via POST /auth/2fa/verify once the code is entered.
// ─────────────────────────────────────────────────────────────────────────────

const PENDING_TOTP_TTL = "5m";
const PENDING_TOTP_TYPE = "pending_totp";

export function signPendingTotpToken(user: { id: string; email: string }): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      type: PENDING_TOTP_TYPE,
      jti: randomUUID(),
      iss: config.JWT_ISSUER,
      aud: config.JWT_AUDIENCE,
    },
    config.JWT_SECRET,
    { expiresIn: PENDING_TOTP_TTL }
  );
}

export function verifyPendingTotpToken(token: string): { sub: string; email: string } {
  const payload = jwt.verify(token, config.JWT_SECRET, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  }) as { sub: string; email: string; type: string };
  if (payload.type !== PENDING_TOTP_TYPE) throw new Error("Not a pending TOTP token");
  return { sub: payload.sub, email: payload.email };
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const TotpCodeSchema = z.object({ code: z.string().min(6).max(8) });
const VerifySchema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().min(6).max(8),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/2fa/status
// ─────────────────────────────────────────────────────────────────────────────

router.get("/status", authenticate, async (req, res) => {
  const enabled = await hasTotpEnabled(req.user!.sub);
  res.json({ totpEnabled: enabled });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/2fa/enroll
// Generates a new TOTP secret, stores it unconfirmed, returns the otpauth URI.
// The client should render the URI as a QR code in the browser (e.g. via
// https://chart.googleapis.com/chart?chs=200x200&chld=M|0&cht=qr&chl=<uri>
// or a client-side library) and prompt the user to scan it.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/enroll", authLimiter, authenticate, async (req, res) => {
  const userId = req.user!.sub;
  const user = await findUserById(userId);
  if (!user) throw createError("User not found", 404);

  if (await hasTotpEnabled(userId)) {
    throw createError("2FA is already enabled for this account", 409, "TOTP_ALREADY_ENABLED");
  }

  const secret = generateTotpSecret();
  await upsertTotpSecret(userId, secret, encryptionKey());

  const otpauthUri = buildOtpauthUri(secret, user.email);

  res.json({
    otpauthUri,
    message:
      "Scan the QR code generated from the otpauthUri in your authenticator app, " +
      "then POST to /auth/2fa/confirm with a valid code to complete enrollment.",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/2fa/confirm
// Verifies the first TOTP code, marks enrollment confirmed, returns backup codes.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/confirm", authLimiter, authenticate, async (req, res) => {
  const { code } = TotpCodeSchema.parse(req.body);
  const userId = req.user!.sub;

  const record = await getTotpSecret(userId, encryptionKey());
  if (!record) {
    throw createError(
      "No pending 2FA enrollment found — call POST /auth/2fa/enroll first",
      400,
      "NO_ENROLLMENT"
    );
  }
  if (record.confirmed) {
    throw createError("2FA is already confirmed for this account", 409, "TOTP_ALREADY_CONFIRMED");
  }

  if (!verifyTotp(code, record.secret)) {
    throw createError("Invalid TOTP code", 400, "INVALID_TOTP_CODE");
  }

  await confirmTotpEnrollment(userId);
  const backupCodes = await generateAndStoreBackupCodes(userId);

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, after)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId, "totp_enrolled", "user", userId, JSON.stringify({ confirmed: true })]
  );

  res.json({
    message:
      "2FA enrollment confirmed. Store your backup codes somewhere safe — they will not be shown again.",
    backupCodes,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/2fa/verify
// Pre-auth. Accepts pendingTotpToken + TOTP or backup code; issues real tokens.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/verify", authLimiter, async (req, res) => {
  const { pendingToken, code } = VerifySchema.parse(req.body);

  let pending: { sub: string; email: string };
  try {
    pending = verifyPendingTotpToken(pendingToken);
  } catch {
    throw createError("Invalid or expired pending token", 401, "INVALID_PENDING_TOKEN");
  }

  const user = await findUserById(pending.sub);
  if (!user) throw createError("User not found", 404);

  const record = await getTotpSecret(pending.sub, encryptionKey());
  if (!record || !record.confirmed) {
    throw createError("2FA is not enabled for this account", 400, "TOTP_NOT_ENABLED");
  }

  const totpValid = verifyTotp(code, record.secret);
  if (!totpValid) {
    // Attempt backup code (normalise casing/whitespace before comparison).
    const normalised = code.replace(/\s/g, "").toUpperCase();
    const backupValid = await consumeBackupCode(pending.sub, normalised);
    if (!backupValid) {
      throw createError("Invalid code", 401, "INVALID_TOTP_CODE");
    }
    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_key, after)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [pending.sub, "totp_backup_code_used", "user", pending.sub, JSON.stringify({})]
    );
  }

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const refreshPayload = verifyRefreshToken(refreshToken);
  await registerRefreshJti(user.id, refreshPayload.jti);

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, after)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      user.id,
      "totp_verified",
      "user",
      user.id,
      JSON.stringify({ method: totpValid ? "totp" : "backup_code" }),
    ]
  );

  res.json({ token: accessToken, refreshToken, user: serializeUser(user) });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /auth/2fa/disenroll
// Requires a valid TOTP code or backup code to confirm before disabling.
// ─────────────────────────────────────────────────────────────────────────────

router.delete("/disenroll", authLimiter, authenticate, async (req, res) => {
  const { code } = TotpCodeSchema.parse(req.body);
  const userId = req.user!.sub;

  const record = await getTotpSecret(userId, encryptionKey());
  if (!record || !record.confirmed) {
    throw createError("2FA is not enabled for this account", 400, "TOTP_NOT_ENABLED");
  }

  const totpValid = verifyTotp(code, record.secret);
  if (!totpValid) {
    const normalised = code.replace(/\s/g, "").toUpperCase();
    const backupValid = await consumeBackupCode(userId, normalised);
    if (!backupValid) {
      throw createError(
        "Invalid code — provide your current TOTP code or a backup code",
        401,
        "INVALID_TOTP_CODE"
      );
    }
  }

  await deleteTotpSecret(userId);

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, after)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId, "totp_disenrolled", "user", userId, JSON.stringify({})]
  );

  res.json({ message: "2FA has been removed from your account." });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/2fa/regenerate-backup-codes
// Replaces all existing backup codes. Requires a valid TOTP code.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/regenerate-backup-codes", authLimiter, authenticate, async (req, res) => {
  const { code } = TotpCodeSchema.parse(req.body);
  const userId = req.user!.sub;

  const record = await getTotpSecret(userId, encryptionKey());
  if (!record || !record.confirmed) {
    throw createError("2FA is not enabled for this account", 400, "TOTP_NOT_ENABLED");
  }

  if (!verifyTotp(code, record.secret)) {
    throw createError("Invalid TOTP code", 401, "INVALID_TOTP_CODE");
  }

  const backupCodes = await generateAndStoreBackupCodes(userId);

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, after)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId, "totp_backup_codes_regenerated", "user", userId, JSON.stringify({})]
  );

  res.json({
    message: "Backup codes regenerated. Store these somewhere safe — they will not be shown again.",
    backupCodes,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function serializeUser(user: {
  id: string;
  email: string;
  display_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  role?: string | null;
  status?: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name ?? null,
    username: user.username ?? null,
    avatarUrl: user.avatar_url ?? null,
    role: (user as any).role ?? "player",
    status: (user as any).status ?? "active",
  };
}

export default router;
