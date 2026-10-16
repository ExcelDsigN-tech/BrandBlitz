import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error";
import brandsRouter from "./brands";

const mocks = vi.hoisted(() => ({
  getPublicBrandById: vi.fn(),
  getPublicBrandChallenges: vi.fn(),
  getPublicBrandStats: vi.fn(),
  toPublicBrandApi: vi.fn((brand: unknown) => brand),
}));

vi.mock("../db/index", () => ({ query: vi.fn() }));
vi.mock("../middleware/authenticate", () => ({
  authenticate: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));
vi.mock("../middleware/rate-limit", () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  questionPreviewLimiter: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../db/queries/brands", () => ({
  createBrand: vi.fn(),
  getBrandsByOwner: vi.fn(),
  getBrandById: vi.fn(),
  getPublicBrandById: mocks.getPublicBrandById,
  getPublicBrands: vi.fn(),
  getPublicBrandChallenges: mocks.getPublicBrandChallenges,
  getPublicBrandStats: mocks.getPublicBrandStats,
  getBrandMetaById: vi.fn(),
  getActiveDistractorBrands: vi.fn(),
  toBrandApi: vi.fn(),
  toPublicBrandApi: mocks.toPublicBrandApi,
  updateBrand: vi.fn(),
  deleteBrand: vi.fn(),
  getBrandChallengeStats: vi.fn(),
}));
vi.mock("../db/queries/analytics", () => ({
  getBrandAnalytics: vi.fn(),
  getBrandBenchmark: vi.fn(),
  BUCKET_LABELS: {},
}));
vi.mock("../db/queries/challenges", () => ({
  createChallenge: vi.fn(),
  insertChallengeQuestions: vi.fn(),
  getChallengeQuestions: vi.fn(),
  getChallengesByBrandId: vi.fn(),
  deleteChallengeQuestion: vi.fn(),
  insertChallengeQuestion: vi.fn(),
}));
vi.mock("../services/questions", () => ({ generateChallengeQuestions: vi.fn() }));
vi.mock("@brandblitz/storage", () => ({
  optimizeImage: vi.fn(),
  StorageError: class StorageError extends Error {},
}));
vi.mock("@brandblitz/stellar", () => ({ MIN_POOL_STROOPS: 1_000_000_000 }));
vi.mock("../lib/config", () => ({ config: {} }));

function createApp() {
  const app = express();
  app.use("/brands", brandsRouter);
  app.use(errorHandler);
  return app;
}

const brandId = "22222222-2222-4222-8222-222222222222";

describe("GET /brands/:id/public", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicBrandById.mockResolvedValue({
      id: brandId,
      name: "Acme",
      logo_url: null,
    });
    mocks.getPublicBrandChallenges.mockResolvedValue([
      {
        id: "challenge-1",
        status: "active",
        pool_amount_usdc: "50.0000000",
        participant_count: 12,
        starts_at: "2026-07-01T00:00:00.000Z",
        ends_at: null,
      },
    ]);
    mocks.getPublicBrandStats.mockResolvedValue({
      total_challenges: 3,
      total_payout_usdc: 120.5,
      avg_rating: 3.75,
      rating_count: 8,
    });
  });

  it("returns public brand fields, challenges and stats", async () => {
    const res = await request(createApp()).get(`/brands/${brandId}/public`).expect(200);

    expect(res.body.brand).toMatchObject({ id: brandId, name: "Acme" });
    expect(res.body.challenges).toHaveLength(1);
    expect(res.body.stats).toEqual({
      total_challenges: 3,
      total_payout_usdc: 120.5,
      avg_rating: 3.75,
      rating_count: 8,
    });
    expect(mocks.getPublicBrandById).toHaveBeenCalledWith(brandId);
  });

  it("returns 404 for a soft-deleted or unknown brand", async () => {
    mocks.getPublicBrandById.mockResolvedValue(null);
    await request(createApp()).get(`/brands/${brandId}/public`).expect(404);
    expect(mocks.getPublicBrandChallenges).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed id without querying", async () => {
    await request(createApp()).get("/brands/not-a-uuid/public").expect(404);
    expect(mocks.getPublicBrandById).not.toHaveBeenCalled();
  });
});
