import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error";
import { authenticate } from "../middleware/authenticate";
import usersRouter from "./users";

const mocks = vi.hoisted(() => ({
  user: {
    sub: "11111111-1111-4111-8111-111111111111",
    role: "user",
    email: "player@example.com",
  } as any,
  query: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  findUserById: vi.fn(),
}));

vi.mock("../db", () => ({
  query: mocks.query,
  pool: { query: mocks.query },
}));

vi.mock("../db/index", () => ({
  query: mocks.query,
  pool: { query: mocks.query },
}));

vi.mock("../db/queries/users", () => ({
  findUserById: mocks.findUserById,
  findUserByPhoneHash: vi.fn(),
  markPhoneVerified: vi.fn(),
  updateUserWallet: vi.fn(),
  updateUserProfile: vi.fn(),
  getUserPublicProfileByUsername: vi.fn(),
  searchUsersByUsername: vi.fn(),
  markOnboardingCompleted: vi.fn(),
}));

vi.mock("../lib/redis", () => ({
  redis: {
    get: mocks.redisGet,
    set: mocks.redisSet,
    del: mocks.redisDel,
    connect: vi.fn(),
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
  app.use("/users", usersRouter);

  app.post("/test/mutation", authenticate, (req, res) => {
    res.json({ ok: true });
  });

  app.use(errorHandler);
  return app;
}

describe("Personal API Keys (#1027)", () => {
  const userId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisGet.mockResolvedValue(null);
    mocks.redisSet.mockResolvedValue("OK");
    mocks.redisDel.mockResolvedValue(1);
    mocks.findUserById.mockResolvedValue({
      id: userId,
      email: "player@example.com",
      username: "player1",
      display_name: "Player One",
      role: "user",
    });
  });

  function makeUserToken() {
    return jwt.sign(
      {
        sub: userId,
        email: "player@example.com",
        role: "user",
        iss: "brandblitz-api",
        aud: "brandblitz-client",
      },
      "test-jwt-secret-that-is-at-least-32-chars-long", // gitleaks:allow
      { expiresIn: "1h" }
    );
  }

  it("POST /users/me/api-keys generates a key and returns the full plaintext key once", async () => {
    const keyId = "33333333-3333-4333-8333-333333333333";
    mocks.query.mockResolvedValue({
      rows: [
        {
          id: keyId,
          name: "My Stats Script",
          key_prefix: "bb_live_abc123",
          scopes: ["read:stats"],
          created_at: new Date().toISOString(),
        },
      ],
    });

    const token = makeUserToken();
    const app = createApp();

    const res = await request(app)
      .post("/users/me/api-keys")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My Stats Script" })
      .expect(201);

    expect(res.body.id).toBe(keyId);
    expect(res.body.name).toBe("My Stats Script");
    expect(res.body.key).toMatch(/^bb_live_[0-9a-f]{48}$/);
    expect(res.body.keyPrefix).toBeDefined();

    // Verify DB insert received the hash, not plaintext
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO api_keys"),
      expect.arrayContaining([
        userId,
        "My Stats Script",
        expect.stringMatching(/^bb_live_/),
        expect.any(String), // key_hash
      ])
    );
  });

  it("GET /users/me/api-keys lists keys with prefix only (never plaintext or hash)", async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "Discord Bot",
          key_prefix: "bb_live_123456", // gitleaks:allow
          scopes: ["read:stats"],
          created_at: "2026-10-15T12:00:00.000Z",
          last_used_at: null,
          revoked_at: null,
        },
      ],
    });

    const token = makeUserToken();
    const app = createApp();

    const res = await request(app)
      .get("/users/me/api-keys")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0].name).toBe("Discord Bot");
    expect(res.body.keys[0].keyPrefix).toBe("bb_live_123456");
    expect(res.body.keys[0].isActive).toBe(true);
    expect(res.body.keys[0].key).toBeUndefined();
    expect(res.body.keys[0].key_hash).toBeUndefined();
  });

  it("authenticates read-only requests using X-API-Key header", async () => {
    const rawApiKey = "bb_live_0123456789abcdef0123456789abcdef0123456789abcdef"; // gitleaks:allow
    const expectedHash = crypto.createHash("sha256").update(rawApiKey).digest("hex");

    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes("FROM api_keys")) {
        return Promise.resolve({
          rows: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              user_id: userId,
              name: "External Integration",
              key_prefix: "bb_live_012345", // gitleaks:allow
              scopes: ["read:stats"],
              revoked_at: null,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = createApp();

    const res = await request(app).get("/users/me").set("X-API-Key", rawApiKey).expect(200);

    expect(res.body.user.id).toBe(userId);
    expect(res.body.user.email).toBe("player@example.com");
  });

  it("blocks mutating requests when authenticated via API key (403 read-only)", async () => {
    const rawApiKey = "bb_live_0123456789abcdef0123456789abcdef0123456789abcdef"; // gitleaks:allow

    const app = createApp();

    const res = await request(app)
      .post("/test/mutation")
      .set("X-API-Key", rawApiKey)
      .send({ action: "mutate" })
      .expect(403);

    expect(res.body.code).toBe("API_KEY_READ_ONLY");
    expect(res.body.error).toContain("read-only");
  });

  it("DELETE /users/me/api-keys/:id revokes the key", async () => {
    const keyId = "33333333-3333-4333-8333-333333333333";
    mocks.query.mockResolvedValue({
      rows: [{ key_hash: "mockhash123" }],
    });

    const token = makeUserToken();
    const app = createApp();

    const res = await request(app)
      .delete(`/users/me/api-keys/${keyId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE api_keys"),
      expect.arrayContaining([keyId, userId])
    );
    expect(mocks.redisDel).toHaveBeenCalledWith("apikey:hash:mockhash123");
  });
});
