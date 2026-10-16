import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const schemaName = `users_test_${Date.now()}_${randomUUID().replace(/-/g, "")}`;

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const existingOptions = url.searchParams.get("options");
  const searchPathOption = `-c search_path=${schema}`;
  url.searchParams.set(
    "options",
    existingOptions ? `${existingOptions} ${searchPathOption}` : searchPathOption
  );
  return url.toString();
}

if (originalDatabaseUrl) {
  process.env.DATABASE_URL = withSearchPath(originalDatabaseUrl, schemaName);
}

const describeIntegration = originalDatabaseUrl ? describe : describe.skip;

describeIntegration("users db queries", () => {
  let query: typeof import("../index").query;
  let closeDb: typeof import("../index").closeDb;
  let users: typeof import("./users");

  beforeAll(async () => {
    const db = await import("../index");
    query = db.query;
    closeDb = db.closeDb;
    users = await import("./users");

    await query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        google_id TEXT UNIQUE,
        display_name TEXT NOT NULL,
        username TEXT UNIQUE,
        avatar_url TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        phone_hash TEXT UNIQUE,
        phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
        phone_verified_at TIMESTAMPTZ,
        age_verified BOOLEAN NOT NULL DEFAULT FALSE,
        kyc_complete BOOLEAN NOT NULL DEFAULT FALSE,
        stellar_address TEXT,
        embedded_wallet_address TEXT,
        league TEXT,
        total_score INTEGER NOT NULL DEFAULT 0,
        total_earned_usdc NUMERIC(20,7) NOT NULL DEFAULT 0,
        challenges_played INTEGER NOT NULL DEFAULT 0,
        state_code TEXT,
        streak INTEGER NOT NULL DEFAULT 0,
        last_play_day DATE,
        streak_repairs_this_month INTEGER NOT NULL DEFAULT 0,
        streak_repair_available BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  });

  afterAll(async () => {
    if (query) {
      await query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    }
    if (closeDb) {
      await closeDb();
    }
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("upsertUser creates new user and updates on google_id conflict", async () => {
    const email = `test-${randomUUID()}@example.com`;
    const googleId = `google-${randomUUID()}`;

    const created = await users.upsertUser({
      email,
      googleId,
      name: "Original Name",
      avatarUrl: "https://old.url",
    });

    expect(created.email).toBe(email);
    expect(created.google_id).toBe(googleId);
    expect(created.display_name).toBe("Original Name");

    const updated = await users.upsertUser({
      email: "new@example.com",
      googleId,
      name: "New Name",
      avatarUrl: "https://new.url",
    });

    expect(updated.id).toBe(created.id);
    expect(updated.email).toBe("new@example.com");
    expect(updated.display_name).toBe("New Name");
  });

  it("upsertUser defaults display_name to email prefix if name is missing", async () => {
    const user = await users.upsertUser({
      email: "jane.doe@example.test",
      googleId: randomUUID(),
    });
    expect(user.display_name).toBe("jane.doe");
  });

  it("findUserByEmail, findUserByGoogleId, findUserById: deterministic null vs row returns", async () => {
    const email = `lookup-${randomUUID()}@test.com`;
    const googleId = `google-${randomUUID()}`;
    const user = await users.upsertUser({ email, googleId });

    expect(await users.findUserById(user.id)).toMatchObject({ id: user.id });
    expect(await users.findUserByEmail(email)).toMatchObject({ id: user.id });
    expect(await users.findUserByGoogleId(googleId)).toMatchObject({ id: user.id });

    expect(await users.findUserById(randomUUID())).toBeNull();
    expect(await users.findUserByEmail("none@test.com")).toBeNull();
  });

  it("findUserByPhoneHash returns user after markPhoneVerified", async () => {
    const user = await users.upsertUser({ email: `phone-${randomUUID()}@test.com`, googleId: randomUUID() });
    const phoneHash = `hash-${randomUUID()}`;

    await users.markPhoneVerified(user.id, phoneHash);
    const found = await users.findUserByPhoneHash(phoneHash);
    expect(found?.id).toBe(user.id);
    expect(found?.phone_verified).toBe(true);
  });

  it("getUserPublicProfileByUsername returns correct public subset", async () => {
    const username = `user_${randomUUID().slice(0, 8)}`;
    const user = await users.upsertUser({ email: `${username}@test.com`, googleId: randomUUID() });
    await query(`UPDATE users SET username = $1, league = 'gold' WHERE id = $2`, [username, user.id]);

    const profile = await users.getUserPublicProfileByUsername(username);
    expect(profile?.username).toBe(username);
    expect(profile?.league).toBe("gold");
    expect((profile as any).email).toBeUndefined();
  });

  it("updateUserWallet updates stellar_address and updated_at", async () => {
    const user = await users.upsertUser({ email: `wallet-${randomUUID()}@test.com`, googleId: randomUUID() });
    const addr = "GABC123...";

    const before = await users.findUserById(user.id);
    await new Promise(r => setTimeout(r, 10)); 
    await users.updateUserWallet(user.id, addr);
    
    const after = await users.findUserById(user.id);
    expect(after?.stellar_address).toBe(addr);
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(new Date(before!.updated_at).getTime());
  });

  it("respects unique constraints on email", async () => {
    const email = `u-${randomUUID()}@test.com`;
    await users.upsertUser({ email, googleId: "g1" });

    // Conflict on google_id is UPSERT (ok), conflict on email with different google_id should throw
    await expect(users.upsertUser({ email, googleId: "g2" }))
      .rejects.toThrow();
  });
});