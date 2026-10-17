import { query } from "../index";

export interface RetentionCell {
  cohort_week: string;
  cohort_size: number;
  week_offset: number;
  retained_users: number;
  retention_pct: number;
}

export async function getBrandRetention(brandId: string) {
  const count = await query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM challenges WHERE brand_id = $1 AND deleted_at IS NULL AND status <> 'draft'",
    [brandId]
  );
  const challengeCount = count.rows[0]?.count ?? 0;
  if (challengeCount < 2) return { challengeCount, cohorts: [] as RetentionCell[] };
  const result = await query<RetentionCell>(
    `WITH participation AS MATERIALIZED (
       SELECT s.user_id,
         date_trunc('week', s.created_at AT TIME ZONE 'UTC')::date AS week
       FROM challenges c
       JOIN game_sessions s ON s.challenge_id = c.id AND s.flagged = FALSE
       WHERE c.brand_id = $1 AND c.deleted_at IS NULL AND c.status <> 'draft'
         AND s.status <> 'flagged' AND s.is_practice = FALSE AND s.user_id IS NOT NULL
         AND s.created_at <= NOW()
     ), first_weeks AS (
       SELECT user_id, MIN(week) AS cohort_week FROM participation GROUP BY user_id
     ), sizes AS (
       SELECT cohort_week, COUNT(*)::int AS cohort_size FROM first_weeks GROUP BY cohort_week
     ), returns AS (
       SELECT f.cohort_week, ((p.week - f.cohort_week) / 7)::int AS week_offset,
         COUNT(DISTINCT p.user_id)::int AS retained_users
       -- game_sessions is unique on (user_id, challenge_id), so a later
       -- participation week necessarily represents a different challenge.
       FROM first_weeks f JOIN participation p ON p.user_id = f.user_id
       GROUP BY f.cohort_week, week_offset
     )
     SELECT to_char(s.cohort_week, 'YYYY-MM-DD') AS cohort_week, s.cohort_size,
       offsets.week_offset, COALESCE(r.retained_users, 0)::int AS retained_users,
       ROUND(100.0 * COALESCE(r.retained_users, 0) / s.cohort_size, 1)::float8 AS retention_pct
     FROM sizes s CROSS JOIN LATERAL generate_series(
       0, LEAST(12, (date_trunc('week', NOW() AT TIME ZONE 'UTC')::date - s.cohort_week) / 7)
     ) AS offsets(week_offset)
     LEFT JOIN returns r ON r.cohort_week = s.cohort_week AND r.week_offset = offsets.week_offset
     ORDER BY s.cohort_week DESC, offsets.week_offset`,
    [brandId]
  );
  return { challengeCount, cohorts: result.rows };
}
