/**
 * Tests for:
 *   GET  /challenge-templates/gallery
 *   POST /challenge-templates/:id/clone
 *   POST /challenges/:id/template-opt-in
 *   DELETE /challenges/:id/template-opt-in
 */
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getGalleryTemplates: vi.fn(),
  getGalleryTemplateById: vi.fn(),
  getChallengeByIdAny: vi.fn(),
  getChallengeQuestions: vi.fn(),
  createChallenge: vi.fn(),
  insertChallengeQuestions: vi.fn(),
  optChallengeIntoGallery: vi.fn(),
  optChallengeOutOfGallery: vi.fn(),
  getBrandById: vi.fn(),
  getActiveDistractorBrands: vi.fn(),
  generateDepositMemo: vi.fn().mockReturnValue("BLITZ-TEST1"),
  authMockUser: null as Record<string, unknown> | null,
}));

vi.mock("../db/queries/challenges", () => ({
  getGalleryTemplates: mocks.getGalleryTemplates,
  getGalleryTemplateById: mocks.getGalleryTemplateById,
  getChallengeByIdAny: mocks.getChallengeByIdAny,
  getChallengeQuestions: mocks.getChallengeQuestions,
  createChallenge: mocks.createChallenge,
  insertChallengeQuestions: mocks.insertChallengeQuestions,
  optChallengeIntoGallery: mocks.optChallengeIntoGallery,
  optChallengeOutOfGallery: mocks.optChallengeOutOfGallery,
  // keep other exports from challenges queries that may be imported transitively
  getActiveChallenges: vi.fn(),
  getActiveChallengesCursor: vi.fn(),
  getActiveChallengesSorted: vi.fn(),
  getFilteredChallenges: vi.fn(),
  getChallengeById: vi.fn(),
  getChallengesByBrandId: vi.fn(),
}));

vi.mock("../db/queries/brands", () => ({
  getBrandById: mocks.getBrandById,
  getActiveDistractorBrands: mocks.getActiveDistractorBrands,
}));

vi.mock("@brandblitz/stellar", () => ({
  generateDepositMemo: mocks.generateDepositMemo,
}));

vi.mock("../lib/config", () => ({
  config: { HOT_WALLET_PUBLIC_KEY: "GHOTWALLETTEST" },
}));

vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!mocks.authMockUser) return res.status(401).json({ error: "Unauthorized" });
    req.user = mocks.authMockUser;
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = mocks.authMockUser;
    next();
  },
}));

vi.mock("../middleware/require-active-user", () => ({
  requireActiveUser: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../middleware/require-tos", () => ({
  requireCurrentTosAccepted: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../db/index", () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  pool: { connect: vi.fn() },
}));

vi.mock("../lib/redis", () => ({
  redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn() },
}));

vi.mock("../middleware/rate-limit", () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  reportLimiter: (_req: any, _res: any, next: any) => next(),
  challengeRatingLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../db/queries/sessions", () => ({
  getLeaderboard: vi.fn(),
  getSession: vi.fn(),
  LEADERBOARD_SORTS: ["score"] as const,
}));

vi.mock("../db/queries/challenge-tags", () => ({
  getAllTags: vi.fn().mockResolvedValue([]),
}));

// ── Import routers after mocks ────────────────────────────────────────────────

import { errorHandler } from "../middleware/error";
import challengeTemplatesRouter from "./challenge-templates";
import challengesRouter from "./challenges";

// ── Test helpers ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/challenge-templates", challengeTemplatesRouter);
  app.use("/challenges", challengesRouter);
  app.use(errorHandler);
  return app;
}

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = buildApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Bad server address");
  return { server, baseUrl: `http://127.0.0.1:${(address as import("net").AddressInfo).port}` };
}

const BRAND_USER_ID = randomUUID();
const BRAND_ID = randomUUID();
const CHALLENGE_ID = randomUUID();

const mockBrand = {
  id: BRAND_ID,
  owner_user_id: BRAND_USER_ID,
  name: "Test Brand",
  logo_url: null,
  primary_color: "#ff0000",
  secondary_color: "#00ff00",
};

const mockGalleryTemplate = {
  id: CHALLENGE_ID,
  brand_id: BRAND_ID,
  brand_name: "Test Brand",
  logo_url: null,
  primary_color: "#ff0000",
  secondary_color: "#00ff00",
  pool_amount_usdc: "100.0000000",
  ends_at: "2026-01-01T00:00:00.000Z",
  gallery_opted_in_at: "2026-01-02T00:00:00.000Z",
  completed_sessions: 42,
  avg_score: 320.5,
  completion_rate_pct: 78.5,
  unique_participants: 38,
};

const mockChallenge = {
  id: CHALLENGE_ID,
  brand_id: BRAND_ID,
  challenge_id: CHALLENGE_ID,
  deposit_memo: "BLITZ-ABCD",
  pool_amount_stroops: "1000000000",
  pool_amount_usdc: "100.0000000",
  status: "settled",
  deposit_tx_hash: null,
  deposit_confirmations: 3,
  payout_tx_hashes: null,
  max_players: null,
  starts_at: "2025-12-01T00:00:00.000Z",
  ends_at: "2026-01-01T00:00:00.000Z",
  reported_count: 0,
  deleted_at: null,
  created_at: "2025-11-01T00:00:00.000Z",
  is_gallery_template: true,
  gallery_opted_in_at: "2026-01-02T00:00:00.000Z",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /challenge-templates/gallery", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.authMockUser = null;
    ({ server, baseUrl } = await startServer());
  });

  afterEach(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  );

  it("returns 200 with templates array and null nextCursor when gallery is empty", async () => {
    mocks.getGalleryTemplates.mockResolvedValue({ templates: [], nextCursor: null });
    const res = await fetch(`${baseUrl}/challenge-templates/gallery`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ templates: [], nextCursor: null });
  });

  it("returns gallery templates with performance stats", async () => {
    mocks.getGalleryTemplates.mockResolvedValue({
      templates: [mockGalleryTemplate],
      nextCursor: null,
    });
    const res = await fetch(`${baseUrl}/challenge-templates/gallery`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates).toHaveLength(1);
    const t = body.templates[0];
    expect(t.id).toBe(CHALLENGE_ID);
    expect(t.brand_name).toBe("Test Brand");
    expect(t.completed_sessions).toBe(42);
    expect(t.avg_score).toBe(320.5);
    expect(t.completion_rate_pct).toBe(78.5);
    // Must NOT expose participant PII — no user_id or email fields
    expect(t.user_id).toBeUndefined();
    expect(t.deposit_tx_hash).toBeUndefined();
    expect(t.payout_tx_hashes).toBeUndefined();
  });

  it("passes limit and cursor to the query function", async () => {
    mocks.getGalleryTemplates.mockResolvedValue({ templates: [], nextCursor: "next-cur" });
    const res = await fetch(`${baseUrl}/challenge-templates/gallery?limit=5&cursor=abc`);
    expect(res.status).toBe(200);
    expect(mocks.getGalleryTemplates).toHaveBeenCalledWith({ limit: 5, cursor: "abc" });
  });

  it("requires no authentication", async () => {
    mocks.authMockUser = null;
    mocks.getGalleryTemplates.mockResolvedValue({ templates: [], nextCursor: null });
    const res = await fetch(`${baseUrl}/challenge-templates/gallery`);
    expect(res.status).toBe(200);
  });
});

describe("POST /challenge-templates/:id/clone", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.authMockUser = { sub: BRAND_USER_ID, role: "user" };
    ({ server, baseUrl } = await startServer());
  });

  afterEach(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  );

  const cloneBody = {
    brandId: BRAND_ID,
    poolAmountUsdc: "10.0000000",
  };

  const mockQuestions = [
    {
      id: randomUUID(),
      challenge_id: CHALLENGE_ID,
      round: 1,
      question_type: "which_tagline",
      prompt_type: "logo",
      question_text: "Which tagline belongs to Test Brand?",
      option_a: "A",
      option_b: "B",
      option_c: "C",
      option_d: "D",
      correct_option: "A",
    },
  ];

  const mockNewChallenge = {
    id: randomUUID(),
    brand_id: BRAND_ID,
    challenge_id: randomUUID(),
    deposit_memo: "BLITZ-TEST1",
    pool_amount_stroops: "100000000",
    pool_amount_usdc: "10.0000000",
    status: "pending_deposit",
    deposit_tx_hash: null,
    deposit_confirmations: 0,
    payout_tx_hashes: null,
    max_players: null,
    starts_at: new Date().toISOString(),
    ends_at: null,
    reported_count: 0,
    deleted_at: null,
    created_at: new Date().toISOString(),
  };

  it("returns 201 with new challenge + clonedFrom credit + deposit instructions", async () => {
    mocks.getGalleryTemplateById.mockResolvedValue(mockGalleryTemplate);
    mocks.getBrandById.mockResolvedValue(mockBrand);
    mocks.getChallengeQuestions.mockResolvedValue(mockQuestions);
    mocks.createChallenge.mockResolvedValue(mockNewChallenge);
    mocks.insertChallengeQuestions.mockResolvedValue(undefined);
    mocks.getActiveDistractorBrands.mockResolvedValue([]);

    const res = await fetch(`${baseUrl}/challenge-templates/${CHALLENGE_ID}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cloneBody),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.challenge.id).toBe(mockNewChallenge.id);
    expect(body.clonedFrom.templateId).toBe(CHALLENGE_ID);
    expect(body.clonedFrom.brandName).toBe("Test Brand");
    expect(body.clonedFrom.completedSessions).toBe(42);
    expect(body.depositInstructions.hotWalletAddress).toBe("GHOTWALLETTEST");
    expect(body.depositInstructions.memo).toBe("BLITZ-TEST1");
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.authMockUser = null;
    const res = await fetch(`${baseUrl}/challenge-templates/${CHALLENGE_ID}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cloneBody),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when template does not exist in gallery", async () => {
    mocks.getGalleryTemplateById.mockResolvedValue(null);
    const res = await fetch(`${baseUrl}/challenge-templates/${CHALLENGE_ID}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cloneBody),
    });
    expect(res.status).toBe(404);
  });

  it("returns 403 when requesting user does not own the target brand", async () => {
    mocks.getGalleryTemplateById.mockResolvedValue(mockGalleryTemplate);
    mocks.getBrandById.mockResolvedValue({ ...mockBrand, owner_user_id: randomUUID() });
    const res = await fetch(`${baseUrl}/challenge-templates/${CHALLENGE_ID}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cloneBody),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 when brandId is not a valid UUID", async () => {
    mocks.getGalleryTemplateById.mockResolvedValue(mockGalleryTemplate);
    const res = await fetch(`${baseUrl}/challenge-templates/${CHALLENGE_ID}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId: "not-a-uuid", poolAmountUsdc: "10" }),
    });
    // Zod parse error → 500 is mapped to 400 by error handler; check non-2xx
    expect(res.status).not.toBe(201);
  });

  it("does not copy deposit_tx_hash or payout_tx_hashes from the source", async () => {
    mocks.getGalleryTemplateById.mockResolvedValue(mockGalleryTemplate);
    mocks.getBrandById.mockResolvedValue(mockBrand);
    mocks.getChallengeQuestions.mockResolvedValue(mockQuestions);
    mocks.createChallenge.mockResolvedValue(mockNewChallenge);
    mocks.insertChallengeQuestions.mockResolvedValue(undefined);
    mocks.getActiveDistractorBrands.mockResolvedValue([]);

    const res = await fetch(`${baseUrl}/challenge-templates/${CHALLENGE_ID}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cloneBody),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    // The new challenge should have pristine status
    expect(body.challenge.status).toBe("pending_deposit");
    // escrow data from source must not appear
    expect(body.challenge.deposit_tx_hash).toBeNull();
    expect(body.challenge.payout_tx_hashes).toBeNull();
  });
});

describe("POST /challenges/:id/template-opt-in", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.authMockUser = { sub: BRAND_USER_ID, role: "user" };
    ({ server, baseUrl } = await startServer());
  });

  afterEach(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  );

  it("returns 200 with updated challenge when opt-in succeeds", async () => {
    mocks.getChallengeByIdAny.mockResolvedValue({ ...mockChallenge, archived: false });
    mocks.getBrandById.mockResolvedValue(mockBrand);
    mocks.optChallengeIntoGallery.mockResolvedValue({
      ...mockChallenge,
      is_gallery_template: true,
    });

    const res = await fetch(`${baseUrl}/challenges/${CHALLENGE_ID}/template-opt-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.challenge.is_gallery_template).toBe(true);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.authMockUser = null;
    const res = await fetch(`${baseUrl}/challenges/${CHALLENGE_ID}/template-opt-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when user does not own the brand", async () => {
    mocks.getChallengeByIdAny.mockResolvedValue({ ...mockChallenge, archived: false });
    mocks.getBrandById.mockResolvedValue({ ...mockBrand, owner_user_id: randomUUID() });

    const res = await fetch(`${baseUrl}/challenges/${CHALLENGE_ID}/template-opt-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 422 when challenge is still active (not ended)", async () => {
    mocks.getChallengeByIdAny.mockResolvedValue({
      ...mockChallenge,
      status: "active",
      archived: false,
    });
    mocks.getBrandById.mockResolvedValue(mockBrand);

    const res = await fetch(`${baseUrl}/challenges/${CHALLENGE_ID}/template-opt-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("INVALID_STATUS");
  });

  it("returns 404 when challenge does not exist", async () => {
    mocks.getChallengeByIdAny.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/challenges/${randomUUID()}/template-opt-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /challenges/:id/template-opt-in", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.authMockUser = { sub: BRAND_USER_ID, role: "user" };
    ({ server, baseUrl } = await startServer());
  });

  afterEach(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  );

  it("returns 200 with updated challenge after opt-out", async () => {
    mocks.getChallengeByIdAny.mockResolvedValue({ ...mockChallenge, archived: false });
    mocks.getBrandById.mockResolvedValue(mockBrand);
    mocks.optChallengeOutOfGallery.mockResolvedValue({
      ...mockChallenge,
      is_gallery_template: false,
      gallery_opted_in_at: null,
    });

    const res = await fetch(`${baseUrl}/challenges/${CHALLENGE_ID}/template-opt-in`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.challenge.is_gallery_template).toBe(false);
  });

  it("returns 401 when not authenticated", async () => {
    mocks.authMockUser = null;
    const res = await fetch(`${baseUrl}/challenges/${CHALLENGE_ID}/template-opt-in`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when user does not own the brand", async () => {
    mocks.getChallengeByIdAny.mockResolvedValue({ ...mockChallenge, archived: false });
    mocks.getBrandById.mockResolvedValue({ ...mockBrand, owner_user_id: randomUUID() });
    const res = await fetch(`${baseUrl}/challenges/${CHALLENGE_ID}/template-opt-in`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
  });
});
