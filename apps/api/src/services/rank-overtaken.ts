/**
 * Rank-overtaken notification service.
 *
 * After a session is completed, this service checks whether any existing
 * participants have been pushed down the leaderboard by the new score.
 * Affected users get a `rank_overtaken` notification, throttled to at most
 * one per user per challenge every 3 minutes to avoid spam on volatile boards.
 */

import { query } from "../db";
import { logger } from "../lib/logger";
import { redis } from "../lib/redis";

/** Throttle window: max one rank_overtaken notification per user per challenge. */
const THROTTLE_SECONDS = 180; // 3 minutes

function throttleKey(userId: string, challengeId: string): string {
  return `notif:rank_overtaken:${userId}:${challengeId}`;
}

/**
 * Fire-and-forget: detect which participants were overtaken by the newly
 * completed session and insert throttled notifications for each.
 *
 * @param newUserId     - The user who just finished (they are NOT notified)
 * @param challengeId   - The challenge UUID
 * @param newScore      - The total_score of the newly completed session
 * @param challengeName - Human-readable challenge name for the notification payload
 */
export async function notifyOvertakenParticipants(
  newUserId: string,
  challengeId: string,
  newScore: number,
  challengeName: string
): Promise<void> {
  try {
    // Find all completed sessions with a score strictly less than the new
    // score — these participants have been overtaken (their rank worsened).
    // We exclude the submitting user and practice sessions.
    const overtaken = await query<{ user_id: string; total_score: number; rank: number | null }>(
      `SELECT gs.user_id, gs.total_score, gs.rank
       FROM game_sessions gs
       WHERE gs.challenge_id = $1
         AND gs.user_id != $2
         AND gs.status = 'completed'
         AND gs.flagged = FALSE
         AND gs.is_practice = FALSE
         AND gs.total_score < $3
       ORDER BY gs.total_score DESC`,
      [challengeId, newUserId, newScore]
    );

    if (overtaken.rows.length === 0) return;

    // Compute the new rank for each overtaken user: their new rank is at
    // minimum (number of sessions with score >= newScore) + their position
    // among sessions below newScore. We approximate simply as
    // currentRank + 1 (overtaken by at least one person).
    const betterCount = await query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt
       FROM game_sessions
       WHERE challenge_id = $1
         AND status = 'completed'
         AND flagged = FALSE
         AND is_practice = FALSE
         AND total_score >= $2`,
      [challengeId, newScore]
    );
    const leaderCount = betterCount.rows[0]?.cnt ?? 1;

    for (const row of overtaken.rows) {
      const userId = row.user_id;

      // Throttle check via Redis
      const key = throttleKey(userId, challengeId);
      const alreadySent = await redis.get(key);
      if (alreadySent) continue;

      // Approximate new rank (position in leaderboard after this submission)
      const newRankForUser = leaderCount + 1;

      try {
        await query(
          `INSERT INTO notifications (user_id, type, payload)
           VALUES ($1, 'rank_overtaken', $2::jsonb)`,
          [
            userId,
            JSON.stringify({
              challenge_id: challengeId,
              challenge_name: challengeName,
              new_rank: newRankForUser,
            }),
          ]
        );

        // Set throttle flag — expires after window
        await redis.set(key, "1", "EX", THROTTLE_SECONDS);
      } catch (insertErr) {
        logger.warn("Failed to insert rank_overtaken notification", { userId, insertErr });
      }
    }
  } catch (err) {
    // Never let notification logic break the main session-completion flow
    logger.warn("notifyOvertakenParticipants error", { err });
  }
}
