import express from "express";
import request from "supertest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { errorHandler } from "../../middleware/error";

const mocks = vi.hoisted(() => ({
  findUserById: vi.fn(),
  unsuspendUser: vi.fn(),
  suspendUser: vi.fn(),
  listUsers: vi.fn(),
  query: vi.fn(),
  adminUser: { sub: "admin-001", email: "admin@example.com", role: "admin" },
  playerUser: { sub: "player-001", email: "player@example.com", role: "player" },
}));

vi.mock("../../db/queries/users", () => ({
  findUserById: mocks.findUserById,
  unsuspendUser: mocks.unsuspendUser,
  suspendUser: mocks.suspendUser,
  listUsers: mocks.listUsers,
  restoreUser: vi.fn(),
}));

vi.mock("../../db/queries/gdpr", () => ({
  createErasureRequest: vi.fn(),
  findPendingErasureRequest: vi.fn(),
}));

vi.mock("../../queues/gdpr-erasure.queue", () => ({
  enqueueGdprErasure: vi.fn(),
}));

vi.mock("../../db", () => ({
  query: mocks.query,
}));

vi.mock("../../middleware/rate-limit", () => ({
  bulkActionLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../db/pagination", () => {
  const CursorQuerySchema: any = {
    parse: (data: any) => ({
      status: data.status,
      search: data.search,
      cursor: data.cursor,
      limit: data.limit ?? 20,
    }),
    safeParse: (data: any) => ({
      success: true,
      data: {
        status: data.status,
        search: data.search,
        cursor: data.cursor,
        limit: Number(data.limit ?? 20),
      },
    }),
  };
  CursorQuerySchema.merge = () => CursorQuerySchema;
  return {
    CursorQuerySchema,
    encodeCursor: vi.fn(),
    decodeCursorSafe: vi.fn(),
  };
});

vi.mock("../../middleware/authenticate", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user ??= mocks.adminUser;
    next();
  },
}));

vi.mock("../../middleware/require-admin", () => ({
  requireAdmin: (req: any, _res: any, next: any) => {
    if (req.user?.role !== "admin") {
      const err = new Error("Forbidden") as any;
      err.statusCode = 403;
      err.code = "FORBIDDEN";
      throw err;
    }
    next();
  },
}));

import adminUsersRouter from "./users";

const app = express();
app.use(express.json());
app.use("/admin/users", adminUsersRouter);
app.use(errorHandler);

describe("DELETE /admin/users/:userId/suspend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears suspension and returns updated user with suspendedAt null", async () => {
    mocks.findUserById.mockResolvedValueOnce({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "suspended",
      suspended_at: "2026-06-01T00:00:00Z",
      suspension_reason: "Spamming",
    });

    mocks.unsuspendUser.mockResolvedValueOnce({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "active",
      suspended_at: null,
    });

    mocks.query.mockResolvedValueOnce({});

    const res = await request(app)
      .delete("/admin/users/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/suspend")
      .expect(200);

    expect(res.body.message).toBe("User suspension has been lifted.");
    expect(res.body.user.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(res.body.user.status).toBe("active");
    expect(res.body.user.suspendedAt).toBeNull();

    expect(mocks.unsuspendUser).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("'unsuspend'"), [
      "admin-001",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      JSON.stringify({
        suspendedAt: "2026-06-01T00:00:00Z",
        suspensionReason: "Spamming",
      }),
      JSON.stringify({
        suspendedAt: null,
        suspensionReason: null,
      }),
    ]);
  });

  it("returns 404 when the user ID does not exist", async () => {
    mocks.findUserById.mockResolvedValueOnce(null);

    const res = await request(app)
      .delete("/admin/users/dddddddd-dddd-4ddd-8ddd-dddddddddddd/suspend")
      .expect(404);

    expect(res.body.error).toBe("User not found");
    expect(mocks.unsuspendUser).not.toHaveBeenCalled();
  });

  it("returns 409 when the user is not currently suspended", async () => {
    mocks.findUserById.mockResolvedValueOnce({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      status: "active",
      suspended_at: null,
      suspension_reason: null,
    });

    const res = await request(app)
      .delete("/admin/users/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/suspend")
      .expect(409);

    expect(res.body.error).toBe("User is not currently suspended");
    expect(res.body.code).toBe("NOT_SUSPENDED");
    expect(mocks.unsuspendUser).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admin user", async () => {
    vi.mocked((await import("../../middleware/authenticate")).authenticate);
    const app2 = express();
    app2.use(express.json());
    app2.use(
      "/admin/users",
      (req: any, _res: any, next: any) => {
        req.user = mocks.playerUser;
        next();
      },
      adminUsersRouter
    );
    app2.use(errorHandler);

    const res = await request(app2)
      .delete("/admin/users/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/suspend")
      .expect(403);

    expect(res.body.error).toBe("Forbidden");
  });

  it("writes audit_log with action unsuspend and performedBy", async () => {
    mocks.findUserById.mockResolvedValueOnce({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "suspended",
      suspended_at: "2026-06-15T12:00:00Z",
      suspension_reason: "ToS violation",
    });

    mocks.unsuspendUser.mockResolvedValueOnce({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "active",
      suspended_at: null,
    });

    mocks.query.mockResolvedValueOnce({});

    await request(app)
      .delete("/admin/users/cccccccc-cccc-4ccc-8ccc-cccccccccccc/suspend")
      .expect(200);

    const auditCall = mocks.query.mock.calls.find(
      (call: any) => typeof call[0] === "string" && call[0].includes("audit_log")
    );
    expect(auditCall).toBeDefined();
    expect(auditCall[1][0]).toBe("admin-001");
    expect(auditCall[1][1]).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  });
});

describe("POST /admin/users/bulk-suspend", () => {
  const uA = "11111111-1111-4111-8111-111111111111";
  const uB = "22222222-2222-4222-8222-222222222222";
  const uC = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("suspends multiple users, writes one audit entry each, and reports success", async () => {
    mocks.findUserById
      .mockResolvedValueOnce({ id: uA, status: "active", role: "player" })
      .mockResolvedValueOnce({ id: uB, status: "active", role: "player" });
    mocks.suspendUser
      .mockResolvedValueOnce({ id: uA, status: "suspended", suspended_at: "2026-06-20T00:00:00Z" })
      .mockResolvedValueOnce({ id: uB, status: "suspended", suspended_at: "2026-06-20T00:00:00Z" });
    mocks.query.mockResolvedValue({});

    const res = await request(app)
      .post("/admin/users/bulk-suspend")
      .send({ userIds: [uA, uB], action: "suspend", reason: "Spam" })
      .expect(200);

    expect(res.body.succeeded).toBe(2);
    expect(res.body.failed).toBe(0);
    expect(res.body.results).toHaveLength(2);
    expect(mocks.suspendUser).toHaveBeenCalledTimes(2);

    const auditCalls = mocks.query.mock.calls.filter(
      (call: any) => typeof call[0] === "string" && call[0].includes("audit_log")
    );
    expect(auditCalls).toHaveLength(2);
  });

  it("reports partial failures per-user", async () => {
    mocks.findUserById
      .mockResolvedValueOnce({ id: uA, status: "active", role: "player" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: uC, status: "suspended", role: "player" });
    mocks.suspendUser.mockResolvedValueOnce({
      id: uA,
      status: "suspended",
      suspended_at: "2026-06-20T00:00:00Z",
    });
    mocks.query.mockResolvedValue({});

    const res = await request(app)
      .post("/admin/users/bulk-suspend")
      .send({ userIds: [uA, uB, uC], reason: "Spam" })
      .expect(200);

    expect(res.body.succeeded).toBe(1);
    expect(res.body.failed).toBe(2);
    const byId = Object.fromEntries(res.body.results.map((r: any) => [r.userId, r]));
    expect(byId[uA].success).toBe(true);
    expect(byId[uB].success).toBe(false);
    expect(byId[uB].code).toBe("NOT_FOUND");
    expect(byId[uC].code).toBe("ALREADY_SUSPENDED");
  });

  it("unsuspends users when action=unsuspend", async () => {
    mocks.findUserById.mockResolvedValueOnce({
      id: uA,
      status: "suspended",
      suspension_reason: "Spam",
      suspended_at: "2026-06-01T00:00:00Z",
    });
    mocks.unsuspendUser.mockResolvedValueOnce({ id: uA, status: "active" });
    mocks.query.mockResolvedValue({});

    const res = await request(app)
      .post("/admin/users/bulk-suspend")
      .send({ userIds: [uA], action: "unsuspend" })
      .expect(200);

    expect(res.body.succeeded).toBe(1);
    expect(mocks.unsuspendUser).toHaveBeenCalledWith(uA);
  });

  it("rejects suspend without a reason", async () => {
    const res = await request(app)
      .post("/admin/users/bulk-suspend")
      .send({ userIds: [uA], action: "suspend" })
      .expect(400);

    expect(res.body.code).toBe("INVALID_BULK_REQUEST");
  });

  it("rejects an empty userIds array", async () => {
    await request(app)
      .post("/admin/users/bulk-suspend")
      .send({ userIds: [], reason: "Spam" })
      .expect(400);
  });
});
