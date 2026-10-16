import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { mockGetUserBadges, mockUpdatePinnedBadges } = vi.hoisted(() => ({
  mockGetUserBadges: vi.fn(),
  mockUpdatePinnedBadges: vi.fn(),
}));

vi.mock("../db/queries/badges", () => ({
  getUserBadges: mockGetUserBadges,
  updatePinnedBadges: mockUpdatePinnedBadges,
}));

vi.mock("../lib/redis", () => ({
  redis: {
    unlink: vi.fn(),
  },
}));

vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "Unauthorized" });
    req.user = { sub: "user-456", email: "player@brandblitz.com" };
    next();
  },
  authenticateOptional: (req: any, _res: any, next: any) => next(),
}));

vi.mock("../middleware/require-admin", () => ({
  requireAdmin: (req: any, res: any, next: any) => next(),
}));

import badgesRouter from "./badges";
import { errorHandler } from "../middleware/error";

const app = express();
app.use(express.json());
app.use("/badges", badgesRouter);
app.use(errorHandler);

describe("Pinned Badges (#1001)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully pins up to 3 earned badges", async () => {
    mockGetUserBadges.mockResolvedValueOnce([
      { badge_slug: "first_win" },
      { badge_slug: "streak_3" },
      { badge_slug: "wins_10" },
    ]);
    mockUpdatePinnedBadges.mockResolvedValueOnce(["first_win", "streak_3"]);

    const res = await request(app)
      .patch("/badges/pinned")
      .set("Authorization", "Bearer valid")
      .send({ badgeIds: ["first_win", "streak_3"] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pinnedBadges).toEqual(["first_win", "streak_3"]);
    expect(mockUpdatePinnedBadges).toHaveBeenCalledWith("user-456", ["first_win", "streak_3"]);
  });

  it("rejects pinning more than 3 badges", async () => {
    const res = await request(app)
      .patch("/badges/pinned")
      .set("Authorization", "Bearer valid")
      .send({ badgeIds: ["first_win", "streak_3", "wins_10", "streak_7"] });

    expect(res.status).toBe(400);
  });

  it("rejects duplicate badge IDs", async () => {
    const res = await request(app)
      .patch("/badges/pinned")
      .set("Authorization", "Bearer valid")
      .send({ badgeIds: ["first_win", "first_win"] });

    expect(res.status).toBe(400);
    const errText = res.body.error?.message || res.body.error;
    expect(errText).toMatch(/duplicate/i);
  });

  it("rejects invalid badge ID not in catalog", async () => {
    const res = await request(app)
      .patch("/badges/pinned")
      .set("Authorization", "Bearer valid")
      .send({ badgeIds: ["non_existent_badge"] });

    expect(res.status).toBe(400);
    const errText = res.body.error?.message || res.body.error;
    expect(errText).toMatch(/invalid badge id/i);
  });

  it("rejects badges the user has not earned", async () => {
    mockGetUserBadges.mockResolvedValueOnce([{ badge_slug: "first_win" }]);

    const res = await request(app)
      .patch("/badges/pinned")
      .set("Authorization", "Bearer valid")
      .send({ badgeIds: ["first_win", "streak_7"] }); // streak_7 not earned!

    expect(res.status).toBe(400);
    const errText = res.body.error?.message || res.body.error;
    expect(errText).toMatch(/not earned badge/i);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app)
      .patch("/badges/pinned")
      .send({ badgeIds: ["first_win"] });

    expect(res.status).toBe(401);
  });
});
