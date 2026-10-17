import { query } from "../index";

export interface UserBadge {
  id: string;
  user_id: string;
  badge_slug: string;
  awarded_at: string;
  created_at: string;
  updated_at: string;
}

export async function awardBadge(userId: string, badgeSlug: string): Promise<UserBadge | null> {
  const result = await query<UserBadge>(
    `INSERT INTO user_badges (user_id, badge_slug)
     VALUES ($1, $2)
     ON CONFLICT (user_id, badge_slug) DO NOTHING
     RETURNING *`,
    [userId, badgeSlug]
  );
  return result.rows[0] ?? null;
}

export async function getUserBadges(userId: string): Promise<UserBadge[]> {
  const result = await query<UserBadge>(
    `SELECT * FROM user_badges WHERE user_id = $1 ORDER BY awarded_at ASC`,
    [userId]
  );
  return result.rows;
}

export async function updatePinnedBadges(userId: string, badgeIds: string[]): Promise<string[]> {
  const result = await query<{ pinned_badges: string[] }>(
    `UPDATE users
     SET pinned_badges = $1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING pinned_badges`,
    [badgeIds, userId]
  );
  return result.rows[0]?.pinned_badges ?? [];
}
