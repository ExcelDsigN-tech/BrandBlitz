import { randomBytes } from "node:crypto";
import { query } from "../index";
import { transaction } from "../transaction";
import { createError } from "../../middleware/error";
import { encodeCursor } from "../pagination";

export interface InviteCode {
  id: string;
  brand_id: string;
  challenge_id: string | null;
  code: string;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  created_at: string;
}

export async function createInviteCode(input: {
  brandId: string;
  actorId: string;
  challengeId?: string;
  expiresAt?: string;
  maxUses?: number;
}): Promise<InviteCode> {
  return transaction(async (client) => {
    const brand = await client.query(
      `SELECT id FROM brands WHERE id = $1 AND owner_user_id = $2
       AND deleted_at IS NULL FOR SHARE`,
      [input.brandId, input.actorId]
    );
    if (!brand.rows.length) throw createError("Brand not found or not owned by you", 403);
    if (input.challengeId) {
      const challenge = await client.query(
        `SELECT id FROM challenges WHERE id = $1 AND brand_id = $2
         AND deleted_at IS NULL FOR SHARE`,
        [input.challengeId, input.brandId]
      );
      if (!challenge.rows.length) throw createError("Challenge not found for this brand", 404);
    }
    const result = await client.query<InviteCode>(
      `INSERT INTO invite_codes (brand_id, challenge_id, code, expires_at, max_uses, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        input.brandId,
        input.challengeId ?? null,
        randomBytes(16).toString("hex").toUpperCase(),
        input.expiresAt ?? null,
        input.maxUses ?? null,
        input.actorId,
      ]
    );
    return result.rows[0];
  });
}

export async function listInviteCodes(brandId: string, cursor?: { createdAt: string; id: string }) {
  const result = await query<InviteCode>(
    `SELECT ic.*, to_char(ic.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
     FROM invite_codes ic WHERE ic.brand_id = $1
     AND ($2::timestamptz IS NULL OR (ic.created_at, ic.id) < ($2, $3::uuid))
     ORDER BY ic.created_at DESC, ic.id DESC LIMIT 101`,
    [brandId, cursor?.createdAt ?? null, cursor?.id ?? null]
  );
  const data = result.rows.slice(0, 100);
  return {
    data,
    nextCursor:
      result.rows.length > 100
        ? encodeCursor({ createdAt: data[99].created_at, id: data[99].id })
        : null,
  };
}

export async function redeemInviteCode(userId: string, code: string) {
  return transaction(async (client) => {
    // One lock serializes capacity checks and retries for a code.
    const result = await client.query<InviteCode>(
      `SELECT ic.* FROM invite_codes ic JOIN brands b ON b.id = ic.brand_id
       LEFT JOIN challenges c ON c.id = ic.challenge_id
       WHERE ic.code = $1 AND b.deleted_at IS NULL
         AND (ic.challenge_id IS NULL OR (c.deleted_at IS NULL AND c.brand_id = ic.brand_id))
       FOR UPDATE OF ic`,
      [code]
    );
    const invite = result.rows[0];
    if (!invite) throw createError("Invalid invite code", 404, "INVALID_INVITE_CODE");
    const previous = await client.query(
      "SELECT 1 FROM invite_code_redemptions WHERE invite_code_id = $1 AND user_id = $2",
      [invite.id, userId]
    );
    // A successful retry stays successful even after expiry or exhaustion.
    if (previous.rows.length) {
      return { status: "active", brandId: invite.brand_id, challengeId: invite.challenge_id };
    }
    if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
      throw createError("Invite code has expired", 410, "INVITE_CODE_EXPIRED");
    }
    if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
      throw createError("Invite code has no uses left", 409, "INVITE_CODE_EXHAUSTED");
    }
    // The email comes from the account, never from untrusted request input.
    const entry = await client.query(
      `SELECT w.id, w.status FROM waitlist w JOIN users u ON lower(u.email) = w.email
       WHERE u.id = $1 AND u.deleted_at IS NULL AND u.status = 'active'
         AND u.suspended_at IS NULL FOR UPDATE OF w`,
      [userId]
    );
    if (!entry.rows.length) {
      throw createError(
        "Join the waitlist with your account email before redeeming",
        403,
        "NOT_WAITLISTED"
      );
    }
    await client.query(
      "INSERT INTO invite_code_redemptions (invite_code_id, user_id) VALUES ($1, $2)",
      [invite.id, userId]
    );
    await client.query("UPDATE invite_codes SET use_count = use_count + 1 WHERE id = $1", [
      invite.id,
    ]);
    await client.query(
      "UPDATE waitlist SET status = 'active', activated_at = COALESCE(activated_at, NOW()) WHERE id = $1",
      [entry.rows[0].id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_key, before, after)
       VALUES ($1, 'waitlist.invite_redeemed', 'waitlist', $2, $3::jsonb, $4::jsonb)`,
      [
        userId,
        entry.rows[0].id,
        JSON.stringify({ status: entry.rows[0].status }),
        JSON.stringify({
          status: "active",
          inviteCodeId: invite.id,
          brandId: invite.brand_id,
          challengeId: invite.challenge_id,
        }),
      ]
    );
    return { status: "active", brandId: invite.brand_id, challengeId: invite.challenge_id };
  });
}
