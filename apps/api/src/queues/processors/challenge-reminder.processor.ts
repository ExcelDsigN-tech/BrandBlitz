import { Worker, type Job } from "bullmq";
import { redis } from "../../lib/redis";
import { query } from "../../db";
import { logger } from "../../lib/logger";
import type { ChallengeReminderJobData } from "../challenge-reminder.queue";

export async function processChallengeReminderJob(
  job: Job<ChallengeReminderJobData>
): Promise<{ dispatched: boolean; reason?: string }> {
  const { challengeId, userId, email, leadTimeMinutes } = job.data;

  // 1. Check challenge existence and status
  const challengeRes = await query<{
    id: string;
    status: string;
    starts_at: string;
    brand_name: string | null;
  }>(
    `SELECT c.id, c.status, c.starts_at, b.name AS brand_name
     FROM challenges c
     LEFT JOIN brands b ON b.id = c.brand_id
     WHERE c.id = $1`,
    [challengeId]
  );

  if (challengeRes.rows.length === 0) {
    logger.info("Challenge reminder skipped: challenge not found", { challengeId });
    return { dispatched: false, reason: "not_found" };
  }

  const challenge = challengeRes.rows[0];

  // 2. Acceptance criterion: "Reminder is skipped if challenge is cancelled before firing"
  if (challenge.status === "cancelled" || challenge.status === "refunded") {
    logger.info("Challenge reminder skipped: challenge is cancelled", {
      challengeId,
      status: challenge.status,
    });
    return { dispatched: false, reason: "cancelled" };
  }

  // 3. Mark reminder sent in challenge_reminders
  await query(
    `UPDATE challenge_reminders
     SET sent_at = NOW()
     WHERE challenge_id = $1 AND email = $2`,
    [challengeId, email]
  ).catch(() => null);

  // 4. Acceptance criterion: "Reuses existing notification delivery pipeline"
  if (userId) {
    try {
      await query(
        `INSERT INTO notifications (user_id, type, payload)
         VALUES ($1, 'challenge_reminder', $2::jsonb)`,
        [
          userId,
          JSON.stringify({
            challenge_id: challengeId,
            brand_name: challenge.brand_name,
            starts_at: challenge.starts_at,
            lead_time_minutes: leadTimeMinutes,
          }),
        ]
      );
    } catch (err) {
      logger.warn("Failed to insert challenge_reminder notification", { userId, err });
    }
  }

  logger.info("Challenge reminder dispatched", {
    challengeId,
    email,
    userId,
    leadTimeMinutes,
  });

  return { dispatched: true };
}

export function createChallengeReminderWorker(): Worker {
  const worker = new Worker(
    "challenge-reminder",
    async (job) => {
      await processChallengeReminderJob(job);
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error("Challenge reminder job failed", {
      jobId: job?.id,
      err,
    });
  });

  return worker;
}
