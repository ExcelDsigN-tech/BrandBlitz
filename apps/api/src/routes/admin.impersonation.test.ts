import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error";
import { authenticate } from "../middleware/authenticate";
import adminUsersRouter from "./admin/users";

const mocks = vi.hoisted(() => ({
  user: {
    sub: "11111111-1111-1111-1111-111111111111",
    role: "admin",
    email: "admin@brandblitz.app",
  } as any,
  query: vi.fn(),
  findUserById: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
}));

vi.mock("../db/index", () => ({
  query: mocks.query,
}));

vi.mock("../db/queries/users", () => ({
  findUserById: mocks.findUserById,
  restoreUser: vi.fn(),
  suspendUser: vi.fn(),
  unsuspendUser: vi.fn(),
}));

vi.mock("../db/queries/gdpr", () => ({
  createErasureRequest: vi.fn(),
  findPendingErasureRequest: vi.fn(),
}));

vi.mock("../queues/gdpr-erasure.queue", () => ({
  enqueueGdprErasure: vi.fn(),
}));

vi.mock("../lib/redis", () => ({
  redis: {
    get: mocks.redisGet,
    set: mocks.redisSet,
  },
}));

vi.mock("../lib/config", () => ({
  config: {
    NODE_ENV: "test",
    JWT_SECRET: "test-jwt-secret-that-is-at-least-32-chars-long", // gitleaks:allow
    JWT_ISSUER: "brandblitz-api",
    JWT_AUDIENCE: "brandblitz-client",
  },
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/admin/users", adminUsersRouter);

  // A protected test endpoint to test mutating vs read-only with impersonated token
  app.get("/test/protected", authenticate, (req, res) => {
    res.json({ ok: true, user: req.user });
  });

  app.post("/test/protected", authenticate, (req, res) => {
    res.json({ ok: true });
  });

  app.use(errorHandler);
  return app;
}

describe("Admin User Impersonation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = {
      sub: "11111111-1111-1111-1111-111111111111",
      role: "admin",
      email: "admin@brandblitz.app",
      iss: "brandblitz-api",
      aud: "brandblitz-client",
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    mocks.redisGet.mockResolvedValue(null);
    mocks.redisSet.mockResolvedValue("OK");
  });

  function makeToken(payload: Record<string, any>) {
    const { exp, iat, ...rest } = payload;
    return jwt.sign(
      {
        iss: "brandblitz-api",
        aud: "brandblitz-client",
        ...rest,
      },
      "test-jwt-secret-that-is-at-least-32-chars-long",
      { expiresIn: "15m" }
    );
  }

  it("issues an impersonation token for a target regular user", async () => {
    const targetUserId = "22222222-2222-4222-8222-222222222222";
    mocks.findUserById.mockResolvedValue({
      id: targetUserId,
      email: "user@example.com",
      username: "targetplayer",
      display_name: "Target Player",
      role: "user",
    });

    const adminToken = makeToken(mocks.user);
    const app = createApp();

    const res = await request(app)
      .post(`/admin/users/${targetUserId}/impersonate-token`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.expiresIn).toBe(900);
    expect(res.body.user.id).toBe(targetUserId);

    // Verify audit log insert
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_log"),
      expect.arrayContaining([mocks.user.sub, targetUserId])
    );

    // Verify token claims
    const decoded = jwt.decode(res.body.token) as any;
    expect(decoded.sub).toBe(targetUserId);
    expect(decoded.isImpersonated).toBe(true);
    expect(decoded.impersonatedBy).toBe(mocks.user.sub);
  });

  it("refuses to issue an impersonation token for an admin user (403)", async () => {
    const otherAdminId = "33333333-3333-4333-8333-333333333333";
    mocks.findUserById.mockResolvedValue({
      id: otherAdminId,
      email: "admin2@brandblitz.app",
      role: "admin",
    });

    const adminToken = makeToken(mocks.user);
    const app = createApp();

    const res = await request(app)
      .post(`/admin/users/${otherAdminId}/impersonate-token`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(403);

    expect(res.body.error).toContain("Cannot impersonate an admin user");
  });

  it("allows read-only requests with an impersonation token", async () => {
    const targetUserId = "22222222-2222-4222-8222-222222222222";
    const impersonationToken = makeToken({
      sub: targetUserId,
      email: "user@example.com",
      role: "user",
      isImpersonated: true,
      impersonatedBy: mocks.user.sub,
    });

    const app = createApp();
    const res = await request(app)
      .get("/test/protected")
      .set("Authorization", `Bearer ${impersonationToken}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.user.sub).toBe(targetUserId);
    expect(res.body.user.isImpersonated).toBe(true);
  });

  it("blocks mutating (POST) requests with an impersonation token (403)", async () => {
    const targetUserId = "22222222-2222-4222-8222-222222222222";
    const impersonationToken = makeToken({
      sub: targetUserId,
      email: "user@example.com",
      role: "user",
      isImpersonated: true,
      impersonatedBy: mocks.user.sub,
    });

    const app = createApp();
    const res = await request(app)
      .post("/test/protected")
      .set("Authorization", `Bearer ${impersonationToken}`)
      .send({ someAction: "mutate" })
      .expect(403);

    expect(res.body.code).toBe("IMPERSONATION_READ_ONLY");
    expect(res.body.error).toContain("read-only");
  });

  it("allows exiting impersonation, revokes token in Redis and writes to audit_log", async () => {
    const targetUserId = "22222222-2222-4222-8222-222222222222";
    const impersonationToken = makeToken({
      sub: targetUserId,
      email: "user@example.com",
      role: "user",
      isImpersonated: true,
      impersonatedBy: mocks.user.sub,
    });

    const app = createApp();
    const res = await request(app)
      .post("/admin/users/impersonate-exit")
      .set("Authorization", `Bearer ${impersonationToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mocks.redisSet).toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_log"),
      expect.arrayContaining([mocks.user.sub, targetUserId])
    );
  });
});
