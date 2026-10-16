import express from "express";
import request from "supertest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { errorHandler } from "../middleware/error";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock("../db/index", () => ({
  query: mocks.dbQuery,
  pool: { connect: vi.fn() },
}));

vi.mock("../middleware/rate-limit", () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  waitlistLimiter: (_req: any, _res: any, next: any) => next(),
}));

import waitlistRouter from "./waitlist";

const app = express();
app.use(express.json());
app.use("/waitlist", waitlistRouter);
app.use(errorHandler);

describe("POST /waitlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 201 on successful signup", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post("/waitlist").send({ email: "test@example.com" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "You're on the list!" });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (email) DO NOTHING"),
      ["test@example.com", null]
    );
  });

  it("returns 201 even for a duplicate email (idempotent, no second row inserted)", async () => {
    // ON CONFLICT DO NOTHING means the INSERT is a no-op; same 201 response
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post("/waitlist").send({ email: "duplicate@example.com" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "You're on the list!" });
    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
  });

  it("accepts optional referral_code", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/waitlist")
      .send({ email: "ref@example.com", referral_code: "FRIENDS10" });

    expect(res.status).toBe(201);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (email) DO NOTHING"),
      ["ref@example.com", "FRIENDS10"]
    );
  });

  it("returns 422 for an invalid email", async () => {
    const res = await request(app).post("/waitlist").send({ email: "not-an-email" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INVALID_EMAIL");
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns 422 for an email over 254 characters", async () => {
    const longEmail = `${"a".repeat(250)}@example.com`;
    expect(longEmail.length).toBeGreaterThan(254);

    const res = await request(app).post("/waitlist").send({ email: longEmail });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INVALID_EMAIL");
  });

  it("returns 429 when the rate limiter blocks the request", async () => {
    const blockedApp = express();
    blockedApp.use(express.json());

    vi.resetModules();
    vi.doMock("../middleware/rate-limit", () => ({
      apiLimiter: (_req: any, _res: any, next: any) => next(),
      waitlistLimiter: (_req: any, res: any) =>
        res.status(429).json({ error: "Too many signup attempts, please try again later" }),
    }));
    vi.doMock("../db/index", () => ({
      query: mocks.dbQuery,
      pool: { connect: vi.fn() },
    }));

    const { default: blockedWaitlistRouter } = await import("./waitlist");
    blockedApp.use("/waitlist", blockedWaitlistRouter);
    blockedApp.use(errorHandler);

    const res = await request(blockedApp).post("/waitlist").send({ email: "rate@example.com" });

    expect(res.status).toBe(429);
  });
});

describe("POST /waitlist entry id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the new entry id so the client can poll its position", async () => {
    const id = "6f1c2c1e-2f5b-4d1a-9b7e-0d3c2b1a0f9e";
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id }] });

    const res = await request(app).post("/waitlist").send({ email: "new@example.com" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "You're on the list!", id });
  });

  it("never returns an id for an email that is already on the list", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post("/waitlist").send({ email: "dupe@example.com" });

    expect(res.body).not.toHaveProperty("id");
  });
});

describe("GET /waitlist/:id/position", () => {
  const id = "6f1c2c1e-2f5b-4d1a-9b7e-0d3c2b1a0f9e";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns position and a wait estimate from recent throughput", async () => {
    // 41 pending ahead -> position 42; 14 activations over 7 days -> 2/day -> 21 days
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ activated: false, ahead: 41, recent_activations: 14 }],
    });

    const res = await request(app).get(`/waitlist/${id}/position`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      activated: false,
      position: 42,
      estimatedWaitSeconds: 21 * 86_400,
      throughputPerDay: 2,
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE w.id = $1"), [id, 7]);
  });

  it("returns a null estimate when nobody was activated in the window", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ activated: false, ahead: 0, recent_activations: 0 }],
    });

    const res = await request(app).get(`/waitlist/${id}/position`);

    expect(res.body).toMatchObject({
      position: 1,
      estimatedWaitSeconds: null,
      throughputPerDay: 0,
    });
  });

  it("reports an activated entry as no longer queued", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ activated: true, ahead: 0, recent_activations: 7 }],
    });

    const res = await request(app).get(`/waitlist/${id}/position`);

    expect(res.body).toMatchObject({ activated: true, position: null, estimatedWaitSeconds: 0 });
  });

  it("returns 404 for an unknown id", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/waitlist/${id}/position`);

    expect(res.status).toBe(404);
  });

  it("returns 404 without querying for a non-UUID id", async () => {
    const res = await request(app).get("/waitlist/alex@example.com/position");

    expect(res.status).toBe(404);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("no longer exposes position lookup by email", async () => {
    const res = await request(app).get("/waitlist/position/alex@example.com");

    expect(res.status).toBe(404);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });
});
