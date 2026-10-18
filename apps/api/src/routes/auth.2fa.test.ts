/**
 * auth.2fa.test.ts — Unit tests for TOTP 2FA endpoints.
 * Closes #1015
 */
import express from "express";
import request from "supertest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import authRouter from "./auth";
import { errorHandler } from "../middleware/error";
import { computeTotp, generateTotpSecret } from "../db/queries/totp";
import jwt from "jsonwebtoken";

// ─────────────────────────────────────────────────────────────────────────────
// Hoist mocks
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  // users queries
  findUserById: vi.fn(),
  upsertUser: vi.fn(),
  updateLastLogin: vi.fn(),
  // totp queries
  hasTotpEnabled: vi.fn(),
  upsertTotpSecret: vi.fn(),
  confirmTotpEnrollment: vi.fn(),
  getTotpSecret: vi.fn(),
  deleteTotpSecret: vi.fn(),
  generateAndStoreBackupCodes: vi.fn(),
  consumeBackupCode: vi.fn(),
  // db
  query: vi.fn(),
  // referrals
  ensureUserReferralCode: vi.fn(),
  consumePendingReferralAttribution: vi.fn(),
  // google-auth
  verifyGoogleIdToken: vi.fn(),
  exchangeGoogleAuthorizationCode: vi.fn(),
  createGooglePkceAuthorizationUrl: vi.fn(),
  // redis
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisSadd: vi.fn(),
  redisExpire: vi.fn(),
  redisSmembers: vi.fn(),
  redisPipelineSet: vi.fn(),
  redisPipelineDel: vi.fn(),
  redisPipelineExec: vi.fn(),
}));

const TEST_JWT_SECRET = "test-jwt-secret-at-least-32-chars!!";

vi.mock("../db/queries/users", () => ({
  findUserById: mocks.findUserById,
  upsertUser: mocks.upsertUser,
  updateLastLogin: mocks.updateLastLogin,
}));

// We mock the DB-layer totp functions but NOT the pure crypto helpers
// (generateTotpSecret, computeTotp, verifyTotp, buildOtpauthUri) so those
// run through the real implementation in the tests.
vi.mock("../db/queries/totp", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/queries/totp")>();
  return {
    ...original, // keep pure functions (generateTotpSecret, computeTotp, verifyTotp, buildOtpauthUri)
    hasTotpEnabled: mocks.hasTotpEnabled,
    upsertTotpSecret: mocks.upsertTotpSecret,
    confirmTotpEnrollment: mocks.confirmTotpEnrollment,
    getTotpSecret: mocks.getTotpSecret,
    deleteTotpSecret: mocks.deleteTotpSecret,
    generateAndStoreBackupCodes: mocks.generateAndStoreBackupCodes,
    consumeBackupCode: mocks.consumeBackupCode,
  };
});

vi.mock("../db", () => ({ query: mocks.query }));

vi.mock("../services/referrals", () => ({
  ensureUserReferralCode: mocks.ensureUserReferralCode,
  consumePendingReferralAttribution: mocks.consumePendingReferralAttribution,
}));

vi.mock("../services/google-auth", () => ({
  verifyGoogleIdToken: mocks.verifyGoogleIdToken,
  exchangeGoogleAuthorizationCode: mocks.exchangeGoogleAuthorizationCode,
  createGooglePkceAuthorizationUrl: mocks.createGooglePkceAuthorizationUrl,
}));

vi.mock("../lib/config", () => ({
  config: {
    JWT_SECRET: TEST_JWT_SECRET,
    JWT_REFRESH_SECRET: TEST_JWT_SECRET,
    JWT_ISSUER: "brandblitz-api",
    JWT_AUDIENCE: "brandblitz-client",
    SESSION_INTEGRITY_KEY: "test-integrity-key-at-least-32chars!!",
    NODE_ENV: "test",
  },
}));

vi.mock("../lib/redis", () => ({
  redis: {
    get: mocks.redisGet,
    set: mocks.redisSet,
    sadd: mocks.redisSadd,
    expire: mocks.redisExpire,
    smembers: mocks.redisSmembers,
    pipeline: () => ({
      set: mocks.redisPipelineSet,
      del: mocks.redisPipelineDel,
      exec: mocks.redisPipelineExec,
    }),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// App factory
// ─────────────────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRouter);
  app.use(errorHandler);
  return app;
}

const BASE_USER = {
  id: "user-123",
  email: "test@example.com",
  display_name: "Test User",
  username: "testuser",
  avatar_url: null,
  role: "player",
  status: "active",
};

function makeAccessToken(userId = BASE_USER.id): string {
  return jwt.sign(
    {
      sub: userId,
      email: BASE_USER.email,
      role: "player",
      iss: "brandblitz-api",
      aud: "brandblitz-client",
    },
    TEST_JWT_SECRET,
    { expiresIn: "15m" }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
  mocks.redisSet.mockResolvedValue("OK");
  mocks.redisGet.mockResolvedValue(null);
  mocks.redisSadd.mockResolvedValue(1);
  mocks.redisExpire.mockResolvedValue(1);
  mocks.redisSmembers.mockResolvedValue([]);
  mocks.redisPipelineSet.mockReturnValue({});
  mocks.redisPipelineDel.mockReturnValue({});
  mocks.redisPipelineExec.mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/2fa/enroll", () => {
  it("returns 401 without auth token", async () => {
    const res = await request(buildApp()).post("/auth/2fa/enroll").send();
    expect(res.status).toBe(401);
  });

  it("returns 409 when 2FA is already enabled", async () => {
    mocks.findUserById.mockResolvedValue(BASE_USER);
    mocks.hasTotpEnabled.mockResolvedValue(true);

    const res = await request(buildApp())
      .post("/auth/2fa/enroll")
      .set("Authorization", `Bearer ${makeAccessToken()}`)
      .send();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TOTP_ALREADY_ENABLED");
  });

  it("returns otpauthUri when enrollment begins", async () => {
    mocks.findUserById.mockResolvedValue(BASE_USER);
    mocks.hasTotpEnabled.mockResolvedValue(false);
    mocks.upsertTotpSecret.mockResolvedValue(undefined);

    const res = await request(buildApp())
      .post("/auth/2fa/enroll")
      .set("Authorization", `Bearer ${makeAccessToken()}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
  });
});

describe("POST /auth/2fa/confirm", () => {
  it("returns 400 when no pending enrollment", async () => {
    mocks.getTotpSecret.mockResolvedValue(null);

    const res = await request(buildApp())
      .post("/auth/2fa/confirm")
      .set("Authorization", `Bearer ${makeAccessToken()}`)
      .send({ code: "123456" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NO_ENROLLMENT");
  });

  it("returns 400 for an invalid code", async () => {
    const secret = generateTotpSecret();
    mocks.getTotpSecret.mockResolvedValue({ secret, confirmed: false });

    const res = await request(buildApp())
      .post("/auth/2fa/confirm")
      .set("Authorization", `Bearer ${makeAccessToken()}`)
      .send({ code: "000000" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_TOTP_CODE");
  });

  it("confirms enrollment and returns 10 backup codes for a valid code", async () => {
    const secret = generateTotpSecret();
    const validCode = computeTotp(secret);
    mocks.getTotpSecret.mockResolvedValue({ secret, confirmed: false });
    mocks.confirmTotpEnrollment.mockResolvedValue(undefined);
    mocks.generateAndStoreBackupCodes.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => `AAAAA-${String(i).padStart(5, "0")}`)
    );

    const res = await request(buildApp())
      .post("/auth/2fa/confirm")
      .set("Authorization", `Bearer ${makeAccessToken()}`)
      .send({ code: validCode });

    expect(res.status).toBe(200);
    expect(res.body.backupCodes).toHaveLength(10);
    expect(mocks.confirmTotpEnrollment).toHaveBeenCalledWith(BASE_USER.id);
  });
});

describe("POST /auth/2fa/verify", () => {
  it("returns 401 for an invalid pending token", async () => {
    const res = await request(buildApp())
      .post("/auth/2fa/verify")
      .send({ pendingToken: "not-a-jwt", code: "123456" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_PENDING_TOKEN");
  });

  it("issues full token pair for a valid TOTP code", async () => {
    const { signPendingTotpToken } = await import("./auth.2fa");
    const pendingToken = signPendingTotpToken({ id: BASE_USER.id, email: BASE_USER.email });

    const secret = generateTotpSecret();
    const validCode = computeTotp(secret);
    mocks.findUserById.mockResolvedValue(BASE_USER);
    mocks.getTotpSecret.mockResolvedValue({ secret, confirmed: true });

    const res = await request(buildApp())
      .post("/auth/2fa/verify")
      .send({ pendingToken, code: validCode });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
  });

  it("returns 401 for a wrong code when no valid backup code exists", async () => {
    const { signPendingTotpToken } = await import("./auth.2fa");
    const pendingToken = signPendingTotpToken({ id: BASE_USER.id, email: BASE_USER.email });

    mocks.findUserById.mockResolvedValue(BASE_USER);
    mocks.getTotpSecret.mockResolvedValue({ secret: generateTotpSecret(), confirmed: true });
    mocks.consumeBackupCode.mockResolvedValue(false);

    const res = await request(buildApp())
      .post("/auth/2fa/verify")
      .send({ pendingToken, code: "000000" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_TOTP_CODE");
  });
});

describe("GET /auth/2fa/status", () => {
  it("returns totpEnabled: true", async () => {
    mocks.hasTotpEnabled.mockResolvedValue(true);
    const res = await request(buildApp())
      .get("/auth/2fa/status")
      .set("Authorization", `Bearer ${makeAccessToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.totpEnabled).toBe(true);
  });

  it("returns totpEnabled: false", async () => {
    mocks.hasTotpEnabled.mockResolvedValue(false);
    const res = await request(buildApp())
      .get("/auth/2fa/status")
      .set("Authorization", `Bearer ${makeAccessToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.totpEnabled).toBe(false);
  });
});

describe("DELETE /auth/2fa/disenroll", () => {
  it("returns 400 when 2FA is not enabled", async () => {
    mocks.getTotpSecret.mockResolvedValue(null);
    const res = await request(buildApp())
      .delete("/auth/2fa/disenroll")
      .set("Authorization", `Bearer ${makeAccessToken()}`)
      .send({ code: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TOTP_NOT_ENABLED");
  });

  it("removes 2FA with a valid TOTP code", async () => {
    const secret = generateTotpSecret();
    const validCode = computeTotp(secret);
    mocks.getTotpSecret.mockResolvedValue({ secret, confirmed: true });
    mocks.deleteTotpSecret.mockResolvedValue(undefined);

    const res = await request(buildApp())
      .delete("/auth/2fa/disenroll")
      .set("Authorization", `Bearer ${makeAccessToken()}`)
      .send({ code: validCode });

    expect(res.status).toBe(200);
    expect(mocks.deleteTotpSecret).toHaveBeenCalledWith(BASE_USER.id);
  });
});

describe("POST /auth/2fa/regenerate-backup-codes", () => {
  it("returns 400 when 2FA is not enabled", async () => {
    mocks.getTotpSecret.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/auth/2fa/regenerate-backup-codes")
      .set("Authorization", `Bearer ${makeAccessToken()}`)
      .send({ code: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TOTP_NOT_ENABLED");
  });

  it("returns 10 new backup codes for a valid TOTP code", async () => {
    const secret = generateTotpSecret();
    const validCode = computeTotp(secret);
    mocks.getTotpSecret.mockResolvedValue({ secret, confirmed: true });
    mocks.generateAndStoreBackupCodes.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => `NEWCO-${String(i).padStart(5, "0")}`)
    );

    const res = await request(buildApp())
      .post("/auth/2fa/regenerate-backup-codes")
      .set("Authorization", `Bearer ${makeAccessToken()}`)
      .send({ code: validCode });

    expect(res.status).toBe(200);
    expect(res.body.backupCodes).toHaveLength(10);
  });
});

describe("POST /auth/google/callback — 2FA gate", () => {
  it("returns requiresTwoFactor: true and a pendingToken when 2FA is enabled", async () => {
    mocks.verifyGoogleIdToken.mockResolvedValue({
      email: BASE_USER.email,
      googleId: "g123",
      name: "Test",
      avatarUrl: null,
    });
    mocks.upsertUser.mockResolvedValue(BASE_USER);
    mocks.ensureUserReferralCode.mockResolvedValue(undefined);
    mocks.consumePendingReferralAttribution.mockResolvedValue(undefined);
    mocks.redisSmembers.mockResolvedValue([]);
    mocks.hasTotpEnabled.mockResolvedValue(true);

    const res = await request(buildApp())
      .post("/auth/google/callback")
      .send({ idToken: "mock-id-token" });

    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactor).toBe(true);
    expect(res.body.pendingToken).toBeTruthy();
    // Full credentials must NOT be issued yet
    expect(res.body.token).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it("returns full tokens when 2FA is not enabled", async () => {
    mocks.verifyGoogleIdToken.mockResolvedValue({
      email: BASE_USER.email,
      googleId: "g123",
      name: "Test",
      avatarUrl: null,
    });
    mocks.upsertUser.mockResolvedValue(BASE_USER);
    mocks.ensureUserReferralCode.mockResolvedValue(undefined);
    mocks.consumePendingReferralAttribution.mockResolvedValue(undefined);
    mocks.redisSmembers.mockResolvedValue([]);
    mocks.hasTotpEnabled.mockResolvedValue(false);
    mocks.updateLastLogin.mockResolvedValue(undefined);

    const res = await request(buildApp())
      .post("/auth/google/callback")
      .send({ idToken: "mock-id-token" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.requiresTwoFactor).toBeUndefined();
  });
});
