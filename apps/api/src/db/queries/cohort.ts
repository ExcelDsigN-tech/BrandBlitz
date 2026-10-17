/**
 * DB queries for the admin cohort/segmentation builder.
 *
 * Filters users into cohorts by:
 *   - signup_source: "referral" | "organic" (referral_code IS [NOT] NULL at creation)
 *   - league:        "bronze" | "silver" | "gold"
 *   - status:        "active" | "suspended"
 *   - min_fraud_flags / max_fraud_flags: count of fraud_flags rows for the user
 *   - min_total_earned_usdc: lifetime earnings threshold
 *   - active_within_days: last_active_at within last N days
 *   - created_after / created_before: ISO 8601 timestamps
 *
 * All filters are optional and ANDed together.
 * Results are cursor-paginated and capped at 500 rows per request.
 * Export path streams all rows matching the filter (up to EXPORT_ROW_LIMIT).
 */

import { query } from "../index";
import { encodeCursor, decodeCursorSafe } from "../pagination";

export const COHORT_MAX_LIMIT = 500;
export const EXPORT_ROW_LIMIT = 10_000;

export interface CohortFilter {
  signup_source?: "referral" | "organic";
  league?: "bronze" | "silver" | "gold";
  status?: "active" | "suspended";
  /** Minimum number of open/escalated fraud flags */
  min_fraud_flags?: number;
  /** Maximum number of open/escalated fraud flags */
  max_fraud_flags?: number;
  /** Minimum lifetime USDC earned */
  min_total_earned_usdc?: number;
  /** User must have been active within last N days */
  active_within_days?: number;
  /** ISO 8601: only users created after this timestamp */
  created_after?: string;
  /** ISO 8601: only users created before this timestamp */
  created_before?: string;
}

export interface CohortUser {
  id: string;
  email: string;
  display_name: string;
  username: string | null;
  role: string;
  status: string;
  league: string | null;
  total_score: number;
  total_earned_usdc: string;
  challenges_played: number;
  streak: number;
  last_active_at: string | null;
  created_at: string;
  referral_code: string | null;
  fraud_flag_count: number;
}

function buildCohortWhere(
  filter: CohortFilter,
  startParamIdx: number = 1
): { conditions: string[]; params: unknown[]; nextIdx: number } {
  const conditions: string[] = ["u.deleted_at IS NULL"];
  const params: unknown[] = [];
  let idx = startParamIdx;

  if (filter.signup_source === "referral") {
    conditions.push("u.referral_code IS NOT NULL");
  } else if (filter.signup_source === "organic") {
    conditions.push("u.referral_code IS NULL");
  }

  if (filter.league) {
    params.push(filter.league);
    conditions.push(`u.league = $${idx++}`);
  }

  if (filter.status) {
    params.push(filter.status);
    conditions.push(`u.status = $${idx++}`);
  }

  if (filter.min_total_earned_usdc !== undefined) {
    params.push(filter.min_total_earned_usdc);
    conditions.push(`u.total_earned_usdc >= $${idx++}`);
  }

  if (filter.active_within_days !== undefined) {
    params.push(filter.active_within_days);
    conditions.push(
      `u.last_active_at >= NOW() - ($${idx++} || ' days')::interval`
    );
  }

  if (filter.created_after) {
    params.push(filter.created_after);
    conditions.push(`u.created_at >= $${idx++}`);
  }

  if (filter.created_before) {
    params.push(filter.created_before);
    conditions.push(`u.created_at <= $${idx++}`);
  }

  return { conditions, params, nextIdx: idx };
}

/**
 * Returns a page of cohort users plus a total count for the given filters.
 * Fraud-flag filters are applied via a HAVING clause on the aggregated count.
 */
export async function getCohortUsers(
  filter: CohortFilter,
  opts: { limit: number; cursor?: string }
): Promise<{ users: CohortUser[]; total: number; nextCursor: string | null }> {
  const limit = Math.min(opts.limit, COHORT_MAX_LIMIT);

  const { conditions, params, nextIdx } = buildCohortWhere(filter, 1);
  let pIdx = nextIdx;

  // Fraud-flag HAVING conditions are evaluated after GROUP BY so we can't put
  // them in WHERE. Build them separately.
  const havingClauses: string[] = [];
  const havingParams: unknown[] = [];

  if (filter.min_fraud_flags !== undefined) {
    havingParams.push(filter.min_fraud_flags);
    havingClauses.push(`COUNT(ff.id) >= $${pIdx + havingParams.length - 1}`);
  }
  if (filter.max_fraud_flags !== undefined) {
    havingParams.push(filter.max_fraud_flags);
    havingClauses.push(`COUNT(ff.id) <= $${pIdx + havingParams.length - 1}`);
  }

  // Re-index having params to follow the WHERE params
  const havingRe: string[] = [];
  for (let i = 0; i < havingClauses.length; i++) {
    havingParams[i]; // already in array
    const opMatch = havingClauses[i].match(/>= |<= /);
    const op = opMatch ? opMatch[0].trim() : ">=";
    havingRe.push(`COUNT(ff.id) ${op} $${pIdx + i}`);
  }
  const allParams = [...params, ...havingParams];
  pIdx += havingParams.length;

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const havingClause = havingRe.length > 0 ? `HAVING ${havingRe.join(" AND ")}` : "";

  // Total count — uses a CTE to avoid re-computing the aggregation twice
  const countParams = [...allParams];
  const countResult = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM (
       SELECT u.id
       FROM users u
       LEFT JOIN fraud_flags ff
         ON ff.user_id = u.id AND ff.status IN ('open', 'escalated')
       ${whereClause}
       GROUP BY u.id
       ${havingClause}
     ) sub`,
    countParams
  );
  const total = parseInt(countResult.rows[0]?.total ?? "0", 10);

  // Cursor pagination on (created_at, id)
  const cursorValues = decodeCursorSafe(opts.cursor, ["created_at", "id"]);
  let cursorClause = "";

  if (cursorValues) {
    allParams.push(cursorValues.created_at, cursorValues.id);
    cursorClause = `AND (u.created_at < $${pIdx} OR (u.created_at = $${pIdx} AND u.id < $${pIdx + 1}))`;
    pIdx += 2;
  }

  allParams.push(limit + 1);
  const limitParam = `$${pIdx}`;

  const rowsResult = await query<CohortUser>(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.username,
       u.role,
       u.status,
       u.league,
       u.total_score,
       u.total_earned_usdc::text AS total_earned_usdc,
       u.challenges_played,
       u.streak,
       u.last_active_at,
       u.created_at,
       u.referral_code,
       COUNT(ff.id)::int AS fraud_flag_count
     FROM users u
     LEFT JOIN fraud_flags ff
       ON ff.user_id = u.id AND ff.status IN ('open', 'escalated')
     ${whereClause}
     ${cursorClause}
     GROUP BY u.id
     ${havingClause}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT ${limitParam}`,
    allParams
  );

  const rows = rowsResult.rows;
  const hasMore = rows.length > limit;
  const users = rows.slice(0, limit);

  const nextCursor =
    hasMore && users.length > 0
      ? encodeCursor({
          created_at: users[users.length - 1].created_at,
          id: users[users.length - 1].id,
        })
      : null;

  return { users, total, nextCursor };
}

/**
 * Stream all matching cohort users for CSV export (no pagination).
 * Capped at EXPORT_ROW_LIMIT rows.
 */
export async function getCohortUsersForExport(
  filter: CohortFilter
): Promise<CohortUser[]> {
  const { conditions, params, nextIdx } = buildCohortWhere(filter, 1);
  let pIdx = nextIdx;

  const havingParams: unknown[] = [];
  const havingRe: string[] = [];

  if (filter.min_fraud_flags !== undefined) {
    havingParams.push(filter.min_fraud_flags);
    havingRe.push(`COUNT(ff.id) >= $${pIdx + havingParams.length - 1}`);
  }
  if (filter.max_fraud_flags !== undefined) {
    havingParams.push(filter.max_fraud_flags);
    havingRe.push(`COUNT(ff.id) <= $${pIdx + havingParams.length - 1}`);
  }

  // Re-index having params
  const havingReFinal: string[] = [];
  for (let i = 0; i < havingRe.length; i++) {
    const opMatch = havingRe[i].match(/>= |<= /);
    const op = opMatch ? opMatch[0].trim() : ">=";
    havingReFinal.push(`COUNT(ff.id) ${op} $${pIdx + i}`);
  }

  const allParams = [...params, ...havingParams];
  pIdx += havingParams.length;

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const havingClause =
    havingReFinal.length > 0 ? `HAVING ${havingReFinal.join(" AND ")}` : "";

  allParams.push(EXPORT_ROW_LIMIT);

  const result = await query<CohortUser>(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.username,
       u.role,
       u.status,
       u.league,
       u.total_score,
       u.total_earned_usdc::text AS total_earned_usdc,
       u.challenges_played,
       u.streak,
       u.last_active_at,
       u.created_at,
       u.referral_code,
       COUNT(ff.id)::int AS fraud_flag_count
     FROM users u
     LEFT JOIN fraud_flags ff
       ON ff.user_id = u.id AND ff.status IN ('open', 'escalated')
     ${whereClause}
     GROUP BY u.id
     ${havingClause}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT $${pIdx}`,
    allParams
  );

  return result.rows;
}
