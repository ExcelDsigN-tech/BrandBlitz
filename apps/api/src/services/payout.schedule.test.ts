import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  enqueuePayoutJob: vi.fn(),
  enqueueLeaderboardRefresh: vi.fn(),
  submitBatchPayout: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../db", () => ({
  query: mocks.query,
}));

vi.mock("../lib/redis", () => ({
  redis: {
    set: mocks.redisSet,
    del: mocks.redisDel,
  },
  stellarSequenceStore: {},
}));

vi.mock("../queues/payout.queue", () => ({
  enqueuePayoutJob: mocks.enqueuePayoutJob,
}));

vi.mock("../queues/leaderboard-refresh.queue", () => ({
  enqueueLeaderboardRefresh: mocks.enqueueLeaderboardRefresh,
}));

vi.mock("@brandblitz/stellar", () => ({
  submitBatchPayout: mocks.submitBatchPayout,
  isRetriableStellarError: vi.fn().mockReturnValue(false),
  isInsufficientFeeError: vi.fn().mockReturnValue(false),
  EscrowClient: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock("../lib/config", () => ({
  config: {
    STELLAR_NETWORK: "testnet",
    HOT_WALLET_SECRET: "SB...fake",
    SOROBAN_CONTRACT_ID: undefined,
  },
}));

import { enqueuePayout, processBatchPayout, processPayout } from "./payout";
import { createChallenge } from "../db/queries/challenges";

describe("Payout Schedule (#1026)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisSet.mockResolvedValue("OK");
    mocks.redisDel.mockResolvedValue(1);
    mocks.enqueuePayoutJob.mockResolvedValue(undefined);
    mocks.enqueueLeaderboardRefresh.mockResolvedValue(undefined);
  });

  describe("default-to-instant", () => {
    it("defaults payout_schedule to 'instant' when not provided during challenge creation", async () => {
      mocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-uuid-1",
            brand_id: "brand-uuid-1",
            challenge_id: "c-123",
            payout_schedule: "instant",
            pool_amount_usdc: "100.0000000",
          },
        ],
      });

      const created = await createChallenge({
        brandId: "brand-uuid-1",
        challengeId: "c-123",
        poolAmountUsdc: "100.00",
      });

      expect(created.payout_schedule).toBe("instant");
      expect(mocks.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO challenges"),
        expect.arrayContaining(["instant"])
      );
    });

    it("respects explicitly configured batched schedule", async () => {
      mocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-uuid-2",
            brand_id: "brand-uuid-1",
            challenge_id: "c-456",
            payout_schedule: "batched",
            pool_amount_usdc: "100.0000000",
          },
        ],
      });

      const created = await createChallenge({
        brandId: "brand-uuid-1",
        challengeId: "c-456",
        poolAmountUsdc: "100.00",
        payoutSchedule: "batched",
      });

      expect(created.payout_schedule).toBe("batched");
      expect(mocks.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO challenges"),
        expect.arrayContaining(["batched"])
      );
    });
  });

  describe("instant path unchanged", () => {
    it("enqueues payout job immediately when payout_schedule is instant", async () => {
      mocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-instant-1",
            status: "ended",
            payout_schedule: "instant",
          },
        ],
      });

      await enqueuePayout("challenge-instant-1");

      expect(mocks.enqueuePayoutJob).toHaveBeenCalledWith("challenge-instant-1");
      expect(mocks.enqueueLeaderboardRefresh).toHaveBeenCalledWith("challenge-instant-1");
    });
  });

  describe("batched challenges deferred until the batch run", () => {
    it("does not enqueue instant payout job when payout_schedule is batched", async () => {
      mocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-batched-1",
            status: "ended",
            payout_schedule: "batched",
          },
        ],
      });

      await enqueuePayout("challenge-batched-1");

      // Payout job must be deferred, not enqueued immediately
      expect(mocks.enqueuePayoutJob).not.toHaveBeenCalled();
      // Leaderboard refresh is still enqueued for finalized scores
      expect(mocks.enqueueLeaderboardRefresh).toHaveBeenCalledWith("challenge-batched-1");
      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        expect.stringContaining("deferred until daily batch run"),
        expect.any(Object)
      );
    });
  });

  describe("batch grouping", () => {
    it("groups and processes all ended batched challenges together in daily run", async () => {
      // Return ended batched challenges
      mocks.query.mockResolvedValueOnce({
        rows: [
          { id: "batch-c-1", status: "ended", payout_schedule: "batched" },
          { id: "batch-c-2", status: "ended", payout_schedule: "batched" },
        ],
      });

      // Mock queries for challenge 1
      mocks.query.mockResolvedValueOnce({
        rows: [{ id: "batch-c-1", status: "ended", payout_schedule: "batched", pool_amount_stroops: "100000000" }],
      });
      // Leaderboard for challenge 1: no sessions (settles cleanly)
      mocks.query.mockResolvedValueOnce({ rows: [] });
      // Update challenge 1 status to settled
      mocks.query.mockResolvedValueOnce({ rows: [] });

      // Mock queries for challenge 2
      mocks.query.mockResolvedValueOnce({
        rows: [{ id: "batch-c-2", status: "ended", payout_schedule: "batched", pool_amount_stroops: "200000000" }],
      });
      // Leaderboard for challenge 2: no sessions (settles cleanly)
      mocks.query.mockResolvedValueOnce({ rows: [] });
      // Update challenge 2 status to settled
      mocks.query.mockResolvedValueOnce({ rows: [] });

      const result = await processBatchPayout();

      expect(result.processedChallenges).toEqual(["batch-c-1", "batch-c-2"]);
      expect(result.failedChallenges).toEqual([]);
      expect(mocks.redisSet).toHaveBeenCalledWith("lock:payout:batch-daily", "1", "EX", 1800, "NX");
      expect(mocks.redisDel).toHaveBeenCalledWith("lock:payout:batch-daily");
    });
  });

  describe("re-run idempotency", () => {
    it("prevents duplicate execution if an overlapping batch run is active", async () => {
      mocks.redisSet.mockResolvedValueOnce(null); // Lock acquisition failed (already held)

      const result = await processBatchPayout();

      expect(result.processedChallenges).toEqual([]);
      expect(result.failedChallenges).toEqual([]);
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining("already in progress")
      );
    });

    it("does not re-pay recipients whose payouts are already sent or confirmed", async () => {
      // Mock challenge
      mocks.query.mockResolvedValueOnce({
        rows: [{ id: "re-run-c-1", status: "ended", payout_schedule: "batched", pool_amount_stroops: "100000000" }],
      });

      // Leaderboard with 1 winner
      mocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: "session-1",
            user_id: "user-1",
            stellar_address: "GA1...",
            total_score: 100,
            completed_at: "2026-10-16T12:00:00Z",
            created_at: "2026-10-16T11:59:00Z",
            integrity_hmac: "valid-hmac",
          },
        ],
      });

      // Mock verifySessionHmac to pass
      vi.spyOn(await import("../lib/integrity"), "verifySessionHmac").mockReturnValue(true);

      // Challenge tiers query
      mocks.query.mockResolvedValueOnce({ rows: [] });
      // Challenge licenses query
      mocks.query.mockResolvedValueOnce({ rows: [] });

      // createPayout returns an existing payout with status 'sent' (already paid)
      mocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: "payout-existing-1",
            challenge_id: "re-run-c-1",
            user_id: "user-1",
            status: "sent",
            amount_stroops: "100000000",
            amount_usdc: "10.0000000",
          },
        ],
      });

      // Update challenge status to settled
      mocks.query.mockResolvedValueOnce({ rows: [] });

      await processPayout("re-run-c-1");

      // submitBatchPayout must NOT be called since the recipient was already sent!
      expect(mocks.submitBatchPayout).not.toHaveBeenCalled();
      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        expect.stringContaining("skipping duplicate submission"),
        expect.any(Object)
      );
    });
  });
});
