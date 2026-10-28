import { query } from "../index";
import { transaction } from "../transaction";
import { encodeCursor } from "../pagination";
import { createError } from "../../middleware/error";

export interface ChallengeComment {
  id: string;
  challenge_id: string;
  user_id: string;
  body: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export async function listChallengeComments(
  challengeId: string,
  limit: number,
  cursor?: { createdAt: string; id: string }
) {
  const result = await query<ChallengeComment>(
    `SELECT cc.*, u.display_name,
       to_char(cc.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
     FROM challenge_comments cc
     JOIN users u ON u.id = cc.user_id AND u.deleted_at IS NULL
     JOIN challenges c ON c.id = cc.challenge_id AND c.deleted_at IS NULL
     WHERE cc.challenge_id = $1
       AND ($2::timestamptz IS NULL OR (cc.created_at, cc.id) < ($2, $3::uuid))
     ORDER BY cc.created_at DESC, cc.id DESC LIMIT $4`,
    [challengeId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1]
  );
  const data = result.rows.slice(0, limit);
  const last = data[data.length - 1];
  return {
    data,
    nextCursor:
      result.rows.length > limit ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}

export async function addChallengeComment(challengeId: string, userId: string, body: string) {
  return transaction(async (client) => {
    // Share lock prevents insertion racing the soft-delete cleanup trigger.
    const challenge = await client.query(
      "SELECT id FROM challenges WHERE id = $1 AND deleted_at IS NULL AND status <> 'draft' FOR SHARE",
      [challengeId]
    );
    if (!challenge.rows.length) throw createError("Challenge not found", 404);
    // Serialize per author across processes, including duplicate-body checks.
    const user = await client.query(
      "SELECT display_name FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      [userId]
    );
    const recent = await client.query<{ count: number; duplicate: boolean }>(
      `SELECT COUNT(*)::int AS count, COALESCE(bool_or(lower(body) = lower($2)), FALSE) AS duplicate
       FROM challenge_comments WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 minute'`,
      [userId, body]
    );
    if (recent.rows[0].count >= 5 || recent.rows[0].duplicate) {
      throw createError("Please wait before posting another comment", 429, "COMMENT_SPAM");
    }
    const result = await client.query<ChallengeComment>(
      "INSERT INTO challenge_comments (challenge_id, user_id, body) VALUES ($1, $2, $3) RETURNING *",
      [challengeId, userId, body]
    );
    return { ...result.rows[0], display_name: user.rows[0].display_name as string };
  });
}
