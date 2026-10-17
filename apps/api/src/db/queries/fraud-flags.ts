import { query } from "../index";
import { encodeCursor, buildCursorWhereSimple, decodeCursorSafe } from "../pagination";

export interface FraudFlag {
  id: string;
  session_id: string;
  user_id: string;
  flag_type: string;
  details: Record<string, unknown> | null;
  status: "open" | "resolved" | "escalated";
  resolution_reason: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FraudFlagDetail extends FraudFlag {
  user_display_name: string;
  user_email: string;
  challenge_id: string;
  round_1_reaction_ms: number | null;
  round_2_reaction_ms: number | null;
  round_3_reaction_ms: number | null;
  session_flag_reasons: string[] | null;
  device_id: string | null;
}

export async function getUserReports(opts: { status?: string; limit: number }) {
  const result = await query<{
    id: string; reporter_id: string; reported_id: string; reason: string; details: string | null;
    status: string; created_at: string;
  }>(
    `SELECT id, reporter_id, reported_id, reason, details, status, created_at
     FROM user_reports
     WHERE ($1::text IS NULL OR status = $1)
     ORDER BY created_at DESC LIMIT $2`,
    [opts.status ?? null, opts.limit]
  );
  return result.rows;
}

export async function createFraudFlag(data: {
  sessionId: string;
  userId: string;
  flagType: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO fraud_flags (session_id, user_id, flag_type, details)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id, flag_type)
     DO UPDATE SET
       details = EXCLUDED.details,
       created_at = EXCLUDED.created_at`,
    [data.sessionId, data.userId, data.flagType, data.details ?? null]
  );
}

export async function getFraudFlags(opts: {
  status?: string;
  cursor?: string;
  pageSize: number;
}): Promise<{ flags: FraudFlagDetail[]; nextCursor: string | null }> {
  const statusParam = opts.status ?? null;
  const cursorValues = decodeCursorSafe(opts.cursor, ["created_at", "id"]);

  let whereExtra = "";
  const params: unknown[] = [statusParam];

  if (cursorValues) {
    const { clause, params: cursorParams } = buildCursorWhereSimple(
      "ff.created_at",
      "DESC",
      cursorValues.created_at,
      cursorValues.id as string,
      2,
    );
    whereExtra = clause;
    params.push(cursorValues.created_at, cursorValues.id);
  }

  params.push(opts.pageSize);

  const rowsResult = await query<FraudFlagDetail>(
    `SELECT
       ff.id,
       ff.session_id,
       ff.user_id,
       ff.flag_type,
       ff.details,
       ff.status,
       ff.resolution_reason,
       ff.resolved_by,
       ff.resolved_at,
       ff.created_at,
       ff.updated_at,
       u.display_name  AS user_display_name,
       u.email         AS user_email,
       gs.challenge_id,
       gs.round_1_reaction_ms,
       gs.round_2_reaction_ms,
       gs.round_3_reaction_ms,
       gs.flag_reasons AS session_flag_reasons,
       gs.device_id
     FROM fraud_flags ff
     JOIN users        u  ON ff.user_id    = u.id
     JOIN game_sessions gs ON ff.session_id = gs.id
     WHERE ($1::text IS NULL OR ff.status = $1)
     ${whereExtra}
     ORDER BY ff.created_at DESC, ff.id DESC
     LIMIT $${params.length}`,
    params,
  );

  const flags = rowsResult.rows;
  const nextCursor: string | null =
    flags.length === opts.pageSize
      ? encodeCursor({
          created_at: flags[flags.length - 1].created_at,
          id: flags[flags.length - 1].id,
        })
      : null;

  return {
    flags,
    nextCursor,
  };
}

export async function getFraudFlagById(id: string): Promise<FraudFlagDetail | null> {
  const result = await query<FraudFlagDetail>(
    `SELECT
       ff.id,
       ff.session_id,
       ff.user_id,
       ff.flag_type,
       ff.details,
       ff.status,
       ff.resolution_reason,
       ff.resolved_by,
       ff.resolved_at,
       ff.created_at,
       ff.updated_at,
       u.display_name  AS user_display_name,
       u.email         AS user_email,
       gs.challenge_id,
       gs.round_1_reaction_ms,
       gs.round_2_reaction_ms,
       gs.round_3_reaction_ms,
       gs.flag_reasons AS session_flag_reasons,
       gs.device_id
     FROM fraud_flags ff
     JOIN users        u  ON ff.user_id    = u.id
     JOIN game_sessions gs ON ff.session_id = gs.id
     WHERE ff.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export interface FraudScoreOverride {
  user_id: string;
  fraud_score_override: number | null;
  fraud_score_override_reason: string | null;
  fraud_score_override_by: string | null;
  fraud_score_override_at: string | null;
}

/**
 * Sets (or clears, when `score` is null) a manual fraud score override for
 * a user, logging the before/after and reason to audit_log (#1010).
 */
export async function setFraudScoreOverride(
  userId: string,
  score: number | null,
  reason: string,
  actorId: string
): Promise<FraudScoreOverride | null> {
  const before = await query<FraudScoreOverride>(
    `SELECT id AS user_id, fraud_score_override, fraud_score_override_reason,
            fraud_score_override_by, fraud_score_override_at
     FROM users WHERE id = $1`,
    [userId]
  );
  if (before.rows.length === 0) return null;

  const result = await query<FraudScoreOverride>(
    `UPDATE users
     SET fraud_score_override = $1,
         fraud_score_override_reason = $2,
         fraud_score_override_by = $3,
         fraud_score_override_at = NOW()
     WHERE id = $4
     RETURNING id AS user_id, fraud_score_override, fraud_score_override_reason,
               fraud_score_override_by, fraud_score_override_at`,
    [score, reason, actorId, userId]
  );

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, before, after)
     VALUES ($1, 'update', 'fraud_score_override', $2, $3, $4)`,
    [
      actorId,
      userId,
      { fraud_score_override: before.rows[0].fraud_score_override },
      { fraud_score_override: score, reason },
    ]
  );

  return result.rows[0] ?? null;
}

export async function updateFraudFlagStatus(
  id: string,
  status: "resolved" | "escalated",
  reason: string,
  resolvedById: string
): Promise<FraudFlagDetail | null> {
  const before = await getFraudFlagById(id);
  if (!before) return null;

  await query(
    `UPDATE fraud_flags
     SET status            = $1,
         resolution_reason = $2,
         resolved_by       = $3,
         resolved_at       = NOW(),
         updated_at        = NOW()
     WHERE id = $4`,
    [status, reason, resolvedById, id]
  );

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, before, after)
     VALUES ($1, 'update', 'fraud_flags', $2, $3, $4)`,
    [
      resolvedById,
      id,
      { status: before.status, resolution_reason: before.resolution_reason },
      { status, resolution_reason: reason },
    ]
  );

  return getFraudFlagById(id);
}
