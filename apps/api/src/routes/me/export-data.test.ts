import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../middleware/authenticate", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { sub: "user-123", email: "alice@example.com" };
    return next();
  },
}));

vi.mock("../../middleware/rate-limit", () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

const { mockFindUserById, mockCollectUserData } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockCollectUserData: vi.fn(),
}));

vi.mock("../../db/queries/users", () => ({ findUserById: mockFindUserById }));
vi.mock("../../db/queries/data-export", () => ({ collectUserData: mockCollectUserData }));

import exportDataRoutes from "./export-data";
import { errorHandler } from "../../middleware/error";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use("/me/export", exportDataRoutes);
  app.use(errorHandler);
});

describe("GET /me/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockResolvedValue({ id: "user-123", email: "alice@example.com" });
    mockCollectUserData.mockResolvedValue({
      exportedAt: "2026-10-16T00:00:00.000Z",
      profile: { id: "user-123", display_name: "Alice" },
      sessions: [{ id: "s1" }],
      payouts: [],
      badges: [],
      ratings: [],
      referrals: { asReferrer: [], asReferred: [] },
      referralPayouts: [],
      fraudFlags: [],
      erasureRequests: [],
    });
  });

  it("returns a downloadable JSON export of the user's data", async () => {
    const res = await request(app).get("/me/export").expect(200);

    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain("brandblitz-data-export-user-123.json");
    expect(res.body).toMatchObject({
      userId: "user-123",
      formatVersion: 1,
      data: { sessions: [{ id: "s1" }] },
    });
    expect(mockCollectUserData).toHaveBeenCalledWith("user-123");
  });

  it("returns 404 when the user no longer exists", async () => {
    mockFindUserById.mockResolvedValue(null);
    await request(app).get("/me/export").expect(404);
    expect(mockCollectUserData).not.toHaveBeenCalled();
  });
});
