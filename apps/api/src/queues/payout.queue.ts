import { Queue, type JobsOptions } from "bullmq";
import { redis } from "../lib/redis";

export const payoutJobOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
} satisfies JobsOptions;

export const payoutQueue = new Queue("payout", {
  connection: redis,
  defaultJobOptions: payoutJobOptions,
});

/**
 * Enqueue payout job with deduplication on challenge_id.
 * Uses deterministic jobId to prevent duplicate jobs for the same challenge
 * when multiple events (session close, webhook, admin retry) fire within a short window.
 * BullMQ silently skips duplicate job additions when jobId already exists in waiting/active state.
 */
export async function enqueuePayoutJob(challengeId: string): Promise<void> {
  await payoutQueue.add(
    "process-payout",
    { challengeId },
    {
      ...payoutJobOptions,
      jobId: `payout:${challengeId}`,
    }
  );
}

export const DEFAULT_BATCH_PAYOUT_CRON = "0 3 * * *"; // Daily, 03:00 UTC

export async function getBatchPayoutCron(): Promise<string> {
  try {
    const { getConfig } = await import("../db/queries/config");
    const configRow = await getConfig("batch_payout_cron");
    if (configRow && typeof configRow.cron === "string") {
      return configRow.cron;
    }
  } catch {
    // Fall back to default
  }
  return process.env.BATCH_PAYOUT_CRON || DEFAULT_BATCH_PAYOUT_CRON;
}

export async function enqueueBatchPayoutJob(): Promise<void> {
  await payoutQueue.add(
    "process-batch-payout",
    {},
    {
      ...payoutJobOptions,
      jobId: `payout:batch:${Date.now()}`,
    }
  );
}

export async function ensureBatchPayoutRepeatableJob(): Promise<void> {
  const cron = await getBatchPayoutCron();

  const repeatableJobs = await payoutQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === "process-batch-payout") {
      await payoutQueue.removeRepeatableByKey(job.key);
    }
  }

  await payoutQueue.add(
    "process-batch-payout",
    {},
    {
      jobId: "payout:batch-daily-scheduled",
      repeat: { pattern: cron, tz: "UTC" },
    }
  );
}

