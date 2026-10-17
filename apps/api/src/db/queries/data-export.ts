import { query } from "../index";

export interface UserDataExport {
  exportedAt: string;
  profile: Record<string, unknown> | null;
  sessions: Record<string, unknown>[];
  payouts: Record<string, unknown>[];
  badges: Record<string, unknown>[];
  ratings: Record<string, unknown>[];
  referrals: {
    asReferrer: Record<string, unknown>[];
    asReferred: Record<string, unknown>[];
  };
  referralPayouts: Record<string, unknown>[];
  fraudFlags: Record<string, unknown>[];
  erasureRequests: Record<string, unknown>[];
}

/**
 * Collects all personal data BrandBlitz holds about a user for GDPR
 * right-to-data-portability (Article 20). Returns raw table rows; callers are
 * responsible for serialisation. Each section is best-effort: a missing table
 * (e.g. an older deployment) yields an empty array rather than failing the
 * whole export.
 */
export async function collectUserData(userId: string): Promise<UserDataExport> {
  const safe = async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => {
    try {
      const result = await query<Record<string, unknown>>(sql, params);
      return result.rows;
    } catch {
      return [];
    }
  };

  const [
    profileRows,
    sessions,
    payouts,
    badges,
    ratings,
    asReferrer,
    asReferred,
    referralPayouts,
    fraudFlags,
    erasureRequests,
  ] = await Promise.all([
    safe("SELECT * FROM users WHERE id = $1", [userId]),
    safe("SELECT * FROM game_sessions WHERE user_id = $1 ORDER BY created_at DESC", [userId]),
    safe("SELECT * FROM payouts WHERE user_id = $1 ORDER BY created_at DESC", [userId]),
    safe("SELECT * FROM user_badges WHERE user_id = $1 ORDER BY awarded_at DESC", [userId]),
    safe("SELECT * FROM challenge_ratings WHERE user_id = $1 ORDER BY created_at DESC", [userId]),
    safe("SELECT * FROM referrals WHERE referrer_id = $1 ORDER BY created_at DESC", [userId]),
    safe("SELECT * FROM referrals WHERE referred_id = $1 ORDER BY created_at DESC", [userId]),
    safe(
      "SELECT * FROM referral_payouts WHERE referrer_id = $1 OR referred_id = $1 ORDER BY created_at DESC",
      [userId]
    ),
    safe("SELECT * FROM fraud_flags WHERE user_id = $1 ORDER BY created_at DESC", [userId]),
    safe(
      "SELECT id, requested_at, execute_at, cancelled_at, executed_at, created_at FROM gdpr_erasure_requests WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    ),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profile: profileRows[0] ?? null,
    sessions,
    payouts,
    badges,
    ratings,
    referrals: { asReferrer, asReferred },
    referralPayouts,
    fraudFlags,
    erasureRequests,
  };
}
