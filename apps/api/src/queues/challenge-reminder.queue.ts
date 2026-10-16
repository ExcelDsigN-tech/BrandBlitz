import { Queue, type JobsOptions } from "bullmq";
import { redis } from "../lib/redis";

export interface ChallengeReminderJobData {
  challengeId: string;
  userId?: string;
  email: string;
  leadTimeMinutes: number;
}

export const challengeReminderJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
};

export const challengeReminderQueue = new Queue<ChallengeReminderJobData>("challenge-reminder", {
  connection: redis,
  defaultJobOptions: challengeReminderJobOptions,
});

export async function scheduleChallengeReminder(data: {
  challengeId: string;
  userId?: string;
  email: string;
  leadTimeMinutes: number;
  startsAt: Date;
}): Promise<{ scheduledFor: Date; delayMs: number }> {
  const leadTimeMs = data.leadTimeMinutes * 60 * 1000;
  const scheduledFor = new Date(data.startsAt.getTime() - leadTimeMs);
  const now = Date.now();
  const delayMs = Math.max(0, scheduledFor.getTime() - now);

  const jobId = `reminder:${data.challengeId}:${data.userId || data.email}:${data.leadTimeMinutes}`;

  await challengeReminderQueue.add(
    "dispatch-reminder",
    {
      challengeId: data.challengeId,
      userId: data.userId,
      email: data.email,
      leadTimeMinutes: data.leadTimeMinutes,
    },
    {
      ...challengeReminderJobOptions,
      delay: delayMs,
      jobId,
    }
  );

  return { scheduledFor, delayMs };
}
