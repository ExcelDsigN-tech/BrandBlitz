import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error";

const mocks = vi.hoisted(() => ({
  user: { sub: "user-1", role: "player" } as { sub: string; role: string } | null,
  getChallengeByIdAny: vi.fn(),
  upsertChallengeRating: vi.fn(),
  hasCompletedChallenge: vi.fn(),
  isUserFraudFlagged: vi.fn(),
}));

vi.mock("../db/queries/challenges", () => ({
  getActiveChallenges: vi.fn(),
  getActiveChallengesCursor: vi.fn(),
  getFilteredChallenges: vi.fn(),
  getChallengeByIdAny: mocks.getChallengeByIdAny,
  getChallengesByBrandId: vi.fn(),
  getChallengeQuestions: vi.fn(),
}));

vi.mock("../db/queries/challenge-ratings", () => ({
  upsertChallengeRating: mocks.upsertChallengeRating,
  hasCompletedChallenge: mocks.hasCompletedChallenge,
  isUserFraudFlagged: mocks.isUserFraudFlagged,
  getChallengeRatingStats: vi.fn(),
}));

vi.mock("../db/queries/brands", () => ({ getBrandById: vi.fn() }));

vi.mock("../db/queries/sessions", () => ({
  getLeaderboard: vi.fn(),
  getArchivedLeaderboard: vi.fn(),
  LEADERBOARD_SORTS: ["score"],
}));

vi.mock("../db/index", () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));

vi.mock("../middleware/authenticate", () => ({
  optionalAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!mocks.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = mocks.user as express.Request["user"];
    next();
  },
}));

vi.mock("../middleware/require-active-user", () => ({
  requireActiveUser: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

vi.mock("../middleware/rate-limit", () => ({
  reportLimiter: (_req: any, _res: any, next: any) => next(),
  challengeRatingLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/cache", () => ({ withCoalescing: vi.fn() }));
vi.mock("../lib/redis", () => ({ redis: { get: vi.fn(), set: vi.fn() } }));
vi.mock("../lib/config", () => ({
  config: { HOT_WALLET_PUBLIC_KEY: "test-wallet", NODE_ENV: "test" },
}));

import challengesRouter from "./challenges";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/challenges", challengesRouter);
  app.use(errorHandler);
  return app;
}

const challenge = { id: "11111111-1111-4111-8111-111111111111", brand_id: "brand-1" };

describe("POST /challenges/:id/rate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { sub: "user-1", role: "player" };
    mocks.getChallengeByIdAny.mockResolvedValue(challenge);
    mocks.isUserFraudFlagged.mockResolvedValue(false);
    mocks.hasCompletedChallenge.mockResolvedValue(true);
    mocks.upsertChallengeRating.mockResolvedValue({
      challenge_id: challenge.id,
      user_id: "user-1",
      difficulty: 4,
    });
  });

  it("stores a valid rating for a completed challenge", async () => {
    const res = await request(createApp())
      .post(`/challenges/${challenge.id}/rate`)
      .send({ difficulty: 4 })
      .expect(201);

    expect(res.body.rating).toEqual({ challengeId: challenge.id, difficulty: 4 });
    expect(mocks.upsertChallengeRating).toHaveBeenCalledWith({
      challengeId: challenge.id,
      userId: "user-1",
      difficulty: 4,
    });
  });

  it("rejects ratings outside the 1-5 range", async () => {
    await request(createApp())
      .post(`/challenges/${challenge.id}/rate`)
      .send({ difficulty: 6 })
      .expect(400);
    expect(mocks.upsertChallengeRating).not.toHaveBeenCalled();
  });

  it("rejects fraudulent accounts", async () => {
    mocks.isUserFraudFlagged.mockResolvedValue(true);
    const res = await request(createApp())
      .post(`/challenges/${challenge.id}/rate`)
      .send({ difficulty: 3 })
      .expect(403);
    expect(res.body.code).toBe("FRAUD_FLAGGED");
  });

  it("rejects users who have not completed the challenge", async () => {
    mocks.hasCompletedChallenge.mockResolvedValue(false);
    const res = await request(createApp())
      .post(`/challenges/${challenge.id}/rate`)
      .send({ difficulty: 3 })
      .expect(409);
    expect(res.body.code).toBe("CHALLENGE_NOT_COMPLETED");
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.user = null;
    await request(createApp())
      .post(`/challenges/${challenge.id}/rate`)
      .send({ difficulty: 3 })
      .expect(401);
  });

  it("returns 404 when the challenge does not exist", async () => {
    mocks.getChallengeByIdAny.mockResolvedValue(null);
    await request(createApp())
      .post(`/challenges/${challenge.id}/rate`)
      .send({ difficulty: 3 })
      .expect(404);
  });
});
