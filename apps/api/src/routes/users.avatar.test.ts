import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error";
import usersRouter from "./users";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  findUserById: vi.fn(),
  uploadObject: vi.fn(),
  deleteObject: vi.fn(),
  optimizeBuffer: vi.fn(),
  optimizeImage: vi.fn(),
  getPublicUrl: vi.fn((bucket: string, key: string) => `https://cdn.brandblitz.io/${bucket}/${key}`),
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

vi.mock("@brandblitz/storage", () => ({
  BUCKETS: {
    BRAND_ASSETS: "brand-assets",
    SHARE_CARDS: "share-cards",
  },
  uploadObject: mocks.uploadObject,
  deleteObject: mocks.deleteObject,
  optimizeBuffer: mocks.optimizeBuffer,
  optimizeImage: mocks.optimizeImage,
  getPublicUrl: mocks.getPublicUrl,
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/users", usersRouter);
  app.use(errorHandler);
  return app;
}

describe("POST /users/me/avatar (#1018)", () => {
  const userId = "11111111-1111-4111-8111-111111111111";

  // PNG magic bytes
  const validPngBuffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 0),
  ]);

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

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisGet.mockResolvedValue(null);
    mocks.redisSet.mockResolvedValue("OK");
    mocks.redisDel.mockResolvedValue(1);
    mocks.uploadObject.mockResolvedValue({});
    mocks.deleteObject.mockResolvedValue({});
    mocks.optimizeBuffer.mockResolvedValue({
      webpBuffer: Buffer.from("mock-webp-buffer"),
      width: 256,
      height: 256,
      format: "webp",
    });
    mocks.optimizeImage.mockResolvedValue("avatars/optimized.webp");
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.findUserById.mockResolvedValue({
      id: userId,
      email: "player@example.com",
      username: "player1",
      display_name: "Player One",
      avatar_url: null,
    });
  });

  it("rejects unauthenticated requests with 401", async () => {
    const app = createApp();

    const res = await request(app)
      .post("/users/me/avatar")
      .attach("avatar", validPngBuffer, "avatar.png")
      .expect(401);

    expect(res.body.error).toMatch(/No token provided/i);
    expect(mocks.uploadObject).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("uploads valid avatar image, optimizes it, updates DB, and returns avatarUrl", async () => {
    const app = createApp();
    const token = makeUserToken();

    const res = await request(app)
      .post("/users/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .attach("avatar", validPngBuffer, "avatar.png")
      .expect(200);

    expect(res.body.avatarUrl).toMatch(/^https:\/\/cdn\.brandblitz\.io\/brand-assets\/avatars\//);
    expect(res.body.avatarUrl).toMatch(/\.webp$/);
    expect(mocks.optimizeBuffer).toHaveBeenCalled();
    expect(mocks.uploadObject).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "brand-assets",
        contentType: "image/webp",
        immutable: true,
      })
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users SET avatar_url"),
      [res.body.avatarUrl, userId]
    );
    // User had no previous avatar, so deleteObject should not have been called
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("cleans up old avatar from storage upon replacing with a new avatar", async () => {
    const app = createApp();
    const token = makeUserToken();

    const oldAvatarKey = "avatars/old-avatar-12345.webp";
    mocks.findUserById.mockResolvedValue({
      id: userId,
      email: "player@example.com",
      username: "player1",
      display_name: "Player One",
      avatar_url: `https://cdn.brandblitz.io/brand-assets/${oldAvatarKey}`,
    });

    const res = await request(app)
      .post("/users/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .attach("avatar", validPngBuffer, "avatar.png")
      .expect(200);

    expect(res.body.avatarUrl).toBeDefined();
    expect(mocks.deleteObject).toHaveBeenCalledWith("brand-assets", oldAvatarKey);
  });

  it("rejects files larger than 1MB with 413 FILE_TOO_LARGE", async () => {
    const app = createApp();
    const token = makeUserToken();

    // 1MB + 50KB file
    const oversizedBuffer = Buffer.concat([
      validPngBuffer,
      Buffer.alloc(1024 * 1024 + 50 * 1024, 0),
    ]);

    const res = await request(app)
      .post("/users/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .attach("avatar", oversizedBuffer, "large.png")
      .expect(413);

    expect(res.body.code).toBe("FILE_TOO_LARGE");
    expect(mocks.uploadObject).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects files with invalid/spoofed MIME type with 415 UNSUPPORTED_MEDIA_TYPE", async () => {
    const app = createApp();
    const token = makeUserToken();

    // Text file pretending to be image/png
    const fakeBuffer = Buffer.from("THIS_IS_NOT_AN_IMAGE_FILE_AT_ALL");

    const res = await request(app)
      .post("/users/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .attach("avatar", fakeBuffer, "fake.png")
      .expect(415);

    expect(res.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(mocks.uploadObject).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("supports updating avatar from presigned upload key", async () => {
    const app = createApp();
    const token = makeUserToken();

    const oldAvatarKey = "avatars/previous-avatar-999.webp";
    mocks.findUserById.mockResolvedValue({
      id: userId,
      avatar_url: `https://cdn.brandblitz.io/brand-assets/${oldAvatarKey}`,
    });

    const res = await request(app)
      .post("/users/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .send({ key: "avatars/new-presigned-upload.png" })
      .expect(200);

    expect(mocks.optimizeImage).toHaveBeenCalledWith("avatars/new-presigned-upload.png", "user-avatar");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users SET avatar_url"),
      [expect.stringContaining("avatars/optimized.webp"), userId]
    );
    expect(mocks.deleteObject).toHaveBeenCalledWith("brand-assets", oldAvatarKey);
  });

  it("rejects presigned upload key outside of avatars/ prefix with 400", async () => {
    const app = createApp();
    const token = makeUserToken();

    const res = await request(app)
      .post("/users/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .send({ key: "logos/exploit.png" })
      .expect(400);

    expect(res.body.error).toMatch(/Invalid avatar key prefix/i);
    expect(mocks.optimizeImage).not.toHaveBeenCalled();
  });
});
