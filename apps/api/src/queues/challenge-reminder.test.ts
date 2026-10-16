import { beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleChallengeReminder, challengeReminderQueue } from "./challenge-reminder.queue";
import { processChallengeReminderJob } from "./processors/challenge-reminder.processor";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queueAdd: vi.fn(),
}));

vi.mock("../lib/redis", () => ({
  redis: { connect: vi.fn() },
}));

vi.mock("bullmq", async () => {
  const actual = await vi.importActual<typeof import("bullmq")>("bullmq");
  return {
    ...actual,
    Queue: vi.fn().mockImplementation(function () {
      return { add: mocks.queueAdd };
    }),
  };
});

vi.mock("../db", () => ({
  query: mocks.query,
}));

describe("Challenge Reminder Queue & Processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("scheduleChallengeReminder", () => {
    it("schedules a reminder with correct delay based on lead time", async () => {
      const startsAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      const leadTimeMinutes = 15; // 15 minutes before

      const result = await scheduleChallengeReminder({
        challengeId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        email: "player@example.com",
        leadTimeMinutes,
        startsAt,
      });

      expect(result.delayMs).toBeGreaterThan(0);
      expect(result.scheduledFor.getTime()).toBe(startsAt.getTime() - leadTimeMinutes * 60 * 1000);
      expect(mocks.queueAdd).toHaveBeenCalledWith(
        "dispatch-reminder",
        expect.objectContaining({
          challengeId: "11111111-1111-4111-8111-111111111111",
          email: "player@example.com",
          leadTimeMinutes: 15,
        }),
        expect.objectContaining({
          jobId: expect.stringContaining("reminder:11111111-1111-4111-8111-111111111111"),
        })
      );
    });
  });

  describe("processChallengeReminderJob", () => {
    it("dispatches notification when challenge is active", async () => {
      const challengeId = "11111111-1111-4111-8111-111111111111";
      const userId = "22222222-2222-4222-8222-222222222222";

      mocks.query.mockImplementation((sql: string) => {
        if (sql.includes("FROM challenges")) {
          return Promise.resolve({
            rows: [
              {
                id: challengeId,
                status: "active",
                starts_at: new Date().toISOString(),
                brand_name: "Stellar",
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const fakeJob = {
        data: {
          challengeId,
          userId,
          email: "player@example.com",
          leadTimeMinutes: 10,
        },
      } as any;

      const outcome = await processChallengeReminderJob(fakeJob);

      expect(outcome.dispatched).toBe(true);
      // Verify notification pipeline insert
      expect(mocks.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO notifications"),
        expect.arrayContaining([userId, expect.stringContaining("challenge_id")])
      );
    });

    it("skips reminder if challenge was cancelled before firing (#1025)", async () => {
      const challengeId = "11111111-1111-4111-8111-111111111111";

      mocks.query.mockImplementation((sql: string) => {
        if (sql.includes("FROM challenges")) {
          return Promise.resolve({
            rows: [
              {
                id: challengeId,
                status: "cancelled",
                starts_at: new Date().toISOString(),
                brand_name: "Stellar",
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const fakeJob = {
        data: {
          challengeId,
          userId: "22222222-2222-4222-8222-222222222222",
          email: "player@example.com",
          leadTimeMinutes: 15,
        },
      } as any;

      const outcome = await processChallengeReminderJob(fakeJob);

      expect(outcome.dispatched).toBe(false);
      expect(outcome.reason).toBe("cancelled");
      // Notification pipeline must NOT have been called
      expect(mocks.query).not.toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO notifications"),
        expect.anything()
      );
    });
  });
});
