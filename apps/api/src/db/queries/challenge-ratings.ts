import { query } from "../index";

export interface ChallengeRating {
  id: string;
  challenge_id: string;
  user_id: string;
  difficulty: number;
  created_at: string;
  updated_at: string;
}

export interface RatingStats {
  avg_difficulty: number | null;
  rating_count: number;
}

/**
 * Insert or update the single rating a user may leave for a challenge.
 * Returns the persisted row.
 */
export async function upsertChallengeRating(data: {
  challengeId: string;
  userId: string;
  difficulty: number;
}): Promise<ChallengeRating> {
  const result = await query<ChallengeRating>(
    `INSERT INTO challenge_ratings (challenge_id, user_id, difficulty)
     VALUES ($1, $2, $3)
     ON CONFLICT (challenge_id, user_id)
     DO UPDATE SET difficulty = EXCLUDED.difficulty, updated_at = NOW()
     RETURNING *`,
    [data.challengeId, data.userId, data.difficulty]
  );
  return result.rows[0];
}

/** Whether the user has a completed session for the challenge. */
export async function hasCompletedChallenge(userId: string, challengeId: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM game_sessions
       WHERE user_id = $1 AND challenge_id = $2 AND status = 'completed'
     ) AS exists`,
    [userId, challengeId]
  );
  return result.rows[0]?.exists ?? false;
}

/** Whether the user has any fraud flag against their account. */
export async function isUserFraudFlagged(userId: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM fraud_flags WHERE user_id = $1) AS exists`,
    [userId]
  );
  return result.rows[0]?.exists ?? false;
}

/**
 * Aggregate difficulty for a single challenge, excluding ratings from users
 * who have since been flagged for fraud.
 */
export async function getChallengeRatingStats(challengeId: string): Promise<RatingStats> {
  const result = await query<RatingStats>(
    `SELECT ROUND(AVG(cr.difficulty)::numeric, 2)::float8 AS avg_difficulty,
            COUNT(*)::int AS rating_count
     FROM challenge_ratings cr
     WHERE cr.challenge_id = $1
       AND NOT EXISTS (SELECT 1 FROM fraud_flags ff WHERE ff.user_id = cr.user_id)`,
    [challengeId]
  );
  return result.rows[0] ?? { avg_difficulty: null, rating_count: 0 };
}

/** Aggregate difficulty across all of a brand's challenges, fraud-excluded. */
export async function getBrandRatingStats(brandId: string): Promise<RatingStats> {
  const result = await query<RatingStats>(
    `SELECT ROUND(AVG(cr.difficulty)::numeric, 2)::float8 AS avg_difficulty,
            COUNT(*)::int AS rating_count
     FROM challenge_ratings cr
     JOIN challenges c ON c.id = cr.challenge_id
     WHERE c.brand_id = $1
       AND NOT EXISTS (SELECT 1 FROM fraud_flags ff WHERE ff.user_id = cr.user_id)`,
    [brandId]
  );
  return result.rows[0] ?? { avg_difficulty: null, rating_count: 0 };
}

/** Per-challenge difficulty for a brand (for dashboard listings). */
export async function getBrandRatingStatsByChallenge(
  brandId: string
): Promise<Array<{ challenge_id: string } & RatingStats>> {
  const result = await query<{ challenge_id: string } & RatingStats>(
    `SELECT cr.challenge_id,
            ROUND(AVG(cr.difficulty)::numeric, 2)::float8 AS avg_difficulty,
            COUNT(*)::int AS rating_count
     FROM challenge_ratings cr
     JOIN challenges c ON c.id = cr.challenge_id
     WHERE c.brand_id = $1
       AND NOT EXISTS (SELECT 1 FROM fraud_flags ff WHERE ff.user_id = cr.user_id)
     GROUP BY cr.challenge_id`,
    [brandId]
  );
  return result.rows;
}
