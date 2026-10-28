import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { schema } = vi.hoisted(() => ({ schema: `engagement_${Date.now()}` }));
vi.mock("../db/index", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema},public`,
    max: 10,
  });
  return { pool, query: pool.query.bind(pool) };
});
vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const userId = req.headers.authorization?.replace("Bearer ", "");
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    req.user = {
      sub: userId,
      email: `${userId}@test.example`,
      role: "player",
    } as express.Request["user"];
    next();
  },
  optionalAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));
vi.mock("../middleware/require-tos", () => ({
  requireCurrentTosAccepted: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock("../middleware/rate-limit", () => {
  const pass = (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next();
  return {
    apiLimiter: pass,
    waitlistLimiter: pass,
    questionPreviewLimiter: pass,
    reportLimiter: pass,
    challengeRatingLimiter: pass,
  };
});
vi.mock("../queues/challenge-reminder.queue", () => ({ scheduleChallengeReminder: vi.fn() }));
vi.mock("../lib/redis", () => ({
  redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn() },
}));

import { query, pool } from "../db/index";
import { errorHandler } from "../middleware/error";
import waitlistRouter from "./waitlist";
import brandsRouter from "./brands";
import commentsRouter from "./challenge-comments";
import managementRouter from "./challenge-management";
import { getBrandRetention } from "../db/queries/retention";

const app = express();
app.use(express.json());
app.use("/api/waitlist", waitlistRouter);
app.use("/api/brands", brandsRouter);
app.use("/api/challenges", commentsRouter, managementRouter);
app.use(errorHandler);

const owner = randomUUID(),
  player = randomUUID(),
  other = randomUUID(),
  brand = randomUUID(),
  challenge = randomUUID();
const auth = (id: string) => `Bearer ${id}`;
const newMigrations = [
  "00036-priority-invite-codes",
  "00037-brand-retention-indexes",
  "00038-challenge-comments",
  "00039-challenge-drafts",
];
async function apply(file: string) {
  await query(await readFile(path.resolve(__dirname, `../../migrations/${file}.sql`), "utf8"));
}
async function invite(options: Record<string, unknown> = {}) {
  const response = await request(app)
    .post(`/api/brands/${brand}/invite-codes`)
    .set("Authorization", auth(owner))
    .send(options)
    .expect(201);
  return response.body.inviteCode as { id: string; code: string };
}
async function redeem(code: string, user = player) {
  return request(app)
    .post("/api/waitlist/redeem-code")
    .set("Authorization", auth(user))
    .send({ code });
}
async function session(user: string, id: string, createdAt = new Date().toISOString(), extra = "") {
  return query(
    `INSERT INTO game_sessions (user_id, challenge_id, status, created_at${extra ? ", flagged" : ""})
    VALUES ($1, $2, 'completed', $3${extra ? ", TRUE" : ""}) RETURNING id`,
    [user, id, createdAt]
  );
}

describe.skipIf(!process.env.DATABASE_URL)("Brand engagement against PostgreSQL", () => {
  beforeAll(async () => {
    await query(`CREATE SCHEMA ${schema}`);
    await apply("00000-initial");
    await apply("00003-soft-delete");
    await apply("0007-archive-tables");
    await apply("0017-waitlist");
    await apply("0027-drop-correct-answer");
    await apply("0027-challenge-tags");
    await apply("00031-brand-members");
    await apply("00035-challenge-payout-schedule");
    for (const legacy of [
      "040_challenge_licenses",
      "041_experiments_moderation_and_league_weights",
    ]) {
      await query(
        await readFile(path.resolve(__dirname, `../../../../migrations/${legacy}.sql`), "utf8")
      );
    }
    for (const file of newMigrations) await apply(file);
  }, 30000);
  afterAll(async () => {
    await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });
  beforeEach(async () => {
    await query("TRUNCATE users CASCADE");
    await query("TRUNCATE waitlist");
    for (const id of [owner, player, other])
      await query("INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)", [
        id,
        `${id}@test.example`,
        id === player ? "Player" : "Other",
      ]);
    await query("INSERT INTO brands (id, owner_user_id, name) VALUES ($1, $2, 'Acme')", [
      brand,
      owner,
    ]);
    await query(
      "INSERT INTO challenges (id, brand_id, challenge_id, status, pool_amount_stroops, deposit_memo, deposit_tx_hash, participant_count) VALUES ($1, $2, $3, 'active', 1000000000, 'old-memo', 'old-escrow-tx', 7)",
      [challenge, brand, randomUUID()]
    );
    await query("INSERT INTO waitlist (email) VALUES ($1), ($2)", [
      `${player}@test.example`,
      `${other}@test.example`,
    ]);
  });

  it("generates owner codes, lists usage, and enforces brand/challenge ownership", async () => {
    const code = await invite({ challengeId: challenge, maxUses: 2 });
    expect(code.code).toMatch(/^[A-F0-9]{32}$/);
    await request(app)
      .get(`/api/brands/${brand}/invite-codes`)
      .set("Authorization", auth(owner))
      .expect(200)
      .expect((res) => expect(res.body.data[0].use_count).toBe(0));
    await request(app)
      .post(`/api/brands/${brand}/invite-codes`)
      .set("Authorization", auth(other))
      .send({})
      .expect(403);
    await request(app)
      .post(`/api/brands/${brand}/invite-codes`)
      .set("Authorization", auth(owner))
      .send({ challengeId: randomUUID() })
      .expect(404);
  });
  it("redeems a code once, promotes the account email, excludes it from FIFO, and audits once", async () => {
    const code = await invite({ maxUses: 1 });
    expect((await redeem(code.code.toLowerCase())).status).toBe(200);
    await query("UPDATE invite_codes SET expires_at = NOW() - INTERVAL '1 day' WHERE id = $1", [
      code.id,
    ]);
    expect((await redeem(code.code)).status).toBe(200);
    expect(
      (await query("SELECT status FROM waitlist WHERE email = $1", [`${player}@test.example`]))
        .rows[0].status
    ).toBe("active");
    expect(
      (await query("SELECT use_count FROM invite_codes WHERE id = $1", [code.id])).rows[0].use_count
    ).toBe(1);
    expect(
      (
        await query(
          "SELECT count(*)::int AS count FROM audit_log WHERE action = 'waitlist.invite_redeemed'"
        )
      ).rows[0].count
    ).toBe(1);
    const otherEntry = await query<{ id: string }>("SELECT id FROM waitlist WHERE email = $1", [
      `${other}@test.example`,
    ]);
    await request(app)
      .get(`/api/waitlist/${otherEntry.rows[0].id}/position`)
      .expect(200)
      .expect((res) => expect(res.body.position).toBe(1));
    await request(app)
      .get("/api/waitlist/access")
      .set("Authorization", auth(player))
      .expect(200)
      .expect({ status: "active" });
  });
  it("serializes concurrent retries without consuming a second use", async () => {
    const code = await invite({ maxUses: 1 });
    const results = await Promise.all([redeem(code.code), redeem(code.code), redeem(code.code)]);
    expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
    expect(
      (await query("SELECT use_count FROM invite_codes WHERE id = $1", [code.id])).rows[0].use_count
    ).toBe(1);
  });
  it("does not oversubscribe a single-use code during competing redemptions", async () => {
    const code = await invite({ maxUses: 1 });
    const results = await Promise.all([redeem(code.code, player), redeem(code.code, other)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });
  it("rejects expired, invalid, anonymous, and suspended redemptions without using capacity", async () => {
    const code = await invite();
    await query("UPDATE invite_codes SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1", [
      code.id,
    ]);
    expect((await redeem(code.code)).status).toBe(410);
    expect((await redeem("A".repeat(32))).status).toBe(404);
    await request(app).post("/api/waitlist/redeem-code").send({ code: code.code }).expect(401);
    await query("UPDATE users SET status = 'suspended', suspended_at = NOW() WHERE id = $1", [
      player,
    ]);
    expect((await redeem(code.code)).status).toBe(403);
    expect(
      (await query("SELECT use_count FROM invite_codes WHERE id = $1", [code.id])).rows[0].use_count
    ).toBe(0);
  });
  it("cannot redeem for someone else's email and rolls back if not waitlisted", async () => {
    const code = await invite();
    await query("DELETE FROM waitlist WHERE email = $1", [`${player}@test.example`]);
    expect((await redeem(code.code)).status).toBe(403);
    expect(
      (await query("SELECT use_count FROM invite_codes WHERE id = $1", [code.id])).rows[0].use_count
    ).toBe(0);
    expect((await query("SELECT * FROM invite_code_redemptions")).rows).toHaveLength(0);
  });
  it("rejects invalid generation limits and expiry", async () => {
    for (const body of [{ maxUses: 0 }, { maxUses: 1.5 }, { expiresAt: "2000-01-01T00:00:00Z" }]) {
      await request(app)
        .post(`/api/brands/${brand}/invite-codes`)
        .set("Authorization", auth(owner))
        .send(body)
        .expect(400);
    }
  });
  it("paginates invite codes with tied timestamps and preserves every code", async () => {
    await query(
      `INSERT INTO invite_codes (brand_id, code, created_at)
      SELECT $1, 'CODE' || value::text, '2026-01-01T00:00:00.123456Z'
      FROM generate_series(1, 101) AS value`,
      [brand]
    );
    const first = await request(app)
      .get(`/api/brands/${brand}/invite-codes`)
      .set("Authorization", auth(owner))
      .expect(200);
    expect(first.body.data).toHaveLength(100);
    const second = await request(app)
      .get(`/api/brands/${brand}/invite-codes`)
      .set("Authorization", auth(owner))
      .query({ cursor: first.body.nextCursor })
      .expect(200);
    expect(second.body.data).toHaveLength(1);
    expect(new Set([...first.body.data, ...second.body.data].map((code) => code.id)).size).toBe(
      101
    );
  });
  it("rolls back promotion and capacity if audit logging fails", async () => {
    const code = await invite({ maxUses: 1 });
    await query(`CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'Audit unavailable'; END; $$;
      CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_test_audit()`);
    try {
      expect((await redeem(code.code)).status).toBe(500);
      expect(
        (await query("SELECT use_count FROM invite_codes WHERE id = $1", [code.id])).rows[0]
          .use_count
      ).toBe(0);
      expect(
        (await query("SELECT status FROM waitlist WHERE email = $1", [`${player}@test.example`]))
          .rows[0].status
      ).toBe("waiting");
    } finally {
      await query("DROP TRIGGER reject_test_audit ON audit_log; DROP FUNCTION reject_test_audit()");
    }
  });
  it("rejects codes scoped to a deleted brand or challenge", async () => {
    const code = await invite({ challengeId: challenge });
    await query("UPDATE challenges SET deleted_at = NOW() WHERE id = $1", [challenge]);
    expect((await redeem(code.code)).status).toBe(404);
    const brandCode = await invite();
    await query("UPDATE brands SET deleted_at = NOW() WHERE id = $1", [brand]);
    expect((await redeem(brandCode.code)).status).toBe(404);
  });
  it("returns a useful empty state for fewer than two challenges", async () => {
    await request(app)
      .get(`/api/brands/${brand}/retention`)
      .set("Authorization", auth(owner))
      .expect(200)
      .expect({ challengeCount: 1, cohorts: [] });
    await request(app)
      .get(`/api/brands/${brand}/retention`)
      .set("Authorization", auth(other))
      .expect(403);
  });
  it("computes UTC cohorts, unique cross-challenge returns and zero-return weeks", async () => {
    const second = randomUUID();
    await query("INSERT INTO challenges (id, brand_id, challenge_id) VALUES ($1, $2, $3)", [
      second,
      brand,
      randomUUID(),
    ]);
    const monday = new Date();
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const firstWeek = new Date(monday.getTime() - 14 * 86400000).toISOString();
    const nextWeek = new Date(monday.getTime() - 7 * 86400000).toISOString();
    await session(player, challenge, firstWeek);
    await session(other, challenge, firstWeek);
    await session(player, second, nextWeek);
    const result = await getBrandRetention(brand);
    expect(
      result.cohorts.map((cell) => [
        cell.week_offset,
        cell.cohort_size,
        cell.retained_users,
        cell.retention_pct,
      ])
    ).toEqual([
      [0, 2, 2, 100],
      [1, 2, 1, 50],
      [2, 2, 0, 0],
    ]);
  });
  it("excludes fraud, practice, and other brands from retention", async () => {
    const second = randomUUID();
    await query("INSERT INTO challenges (id, brand_id, challenge_id) VALUES ($1, $2, $3)", [
      second,
      brand,
      randomUUID(),
    ]);
    await session(player, challenge, undefined, "flagged");
    await session(other, second);
    await query("UPDATE game_sessions SET is_practice = TRUE WHERE user_id = $1", [other]);
    expect((await getBrandRetention(brand)).cohorts).toEqual([]);
  });
  it("provides indexes for brand-filtered session participation", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const result = await client.query(
        `EXPLAIN (FORMAT JSON) SELECT s.user_id, s.created_at
        FROM challenges c JOIN game_sessions s ON s.challenge_id = c.id AND s.flagged = FALSE
        WHERE c.brand_id = $1 AND c.deleted_at IS NULL`,
        [brand]
      );
      const plan = JSON.stringify(result.rows);
      expect(plan).toContain("idx_challenges_retention_brand");
      expect(plan).toContain("idx_sessions_retention_challenge");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("posts plain text and paginates comments without duplicates when timestamps tie", async () => {
    for (let index = 0; index < 3; index++)
      await request(app)
        .post(`/api/challenges/${challenge}/comments`)
        .set("Authorization", auth(player))
        .send({ body: `Comment ${index} <b>text</b>` })
        .expect(201);
    await query("UPDATE challenge_comments SET created_at = '2026-01-01T00:00:00.123456Z'");
    const page = await request(app)
      .get(`/api/challenges/${challenge}/comments?limit=2`)
      .expect(200);
    expect(page.body.data).toHaveLength(2);
    const next = await request(app)
      .get(`/api/challenges/${challenge}/comments`)
      .query({ limit: 2, cursor: page.body.nextCursor })
      .expect(200);
    expect(next.body.data).toHaveLength(1);
    expect(new Set([...page.body.data, ...next.body.data].map((comment) => comment.id)).size).toBe(
      3
    );
  });
  it("rejects profanity, link spam, empty bodies, invalid cursors and anonymous writes", async () => {
    for (const body of [
      "fuck this",
      "https://one https://two https://three",
      " ",
      "a".repeat(2001),
    ]) {
      const response = await request(app)
        .post(`/api/challenges/${challenge}/comments`)
        .set("Authorization", auth(player))
        .send({ body });
      expect([400, 422]).toContain(response.status);
    }
    await request(app).get(`/api/challenges/${challenge}/comments?cursor=garbage`).expect(400);
    await request(app)
      .post(`/api/challenges/${challenge}/comments`)
      .send({ body: "Hello" })
      .expect(401);
  });
  it("blocks duplicate spam and more than five comments per minute across concurrent requests", async () => {
    await request(app)
      .post(`/api/challenges/${challenge}/comments`)
      .set("Authorization", auth(player))
      .send({ body: "Hello" })
      .expect(201);
    await request(app)
      .post(`/api/challenges/${challenge}/comments`)
      .set("Authorization", auth(player))
      .send({ body: "Hello" })
      .expect(429);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        request(app)
          .post(`/api/challenges/${challenge}/comments`)
          .set("Authorization", auth(player))
          .send({ body: `Different ${index}` })
      )
    );
    expect(results.filter((result) => result.status === 201)).toHaveLength(4);
    expect(results.filter((result) => result.status === 429)).toHaveLength(2);
  });
  it("reuses fraud checks to block flagged commenters", async () => {
    const game = await session(player, challenge);
    await query(
      "INSERT INTO fraud_flags (session_id, user_id, flag_type) VALUES ($1, $2, 'spam')",
      [game.rows[0].id, player]
    );
    await request(app)
      .post(`/api/challenges/${challenge}/comments`)
      .set("Authorization", auth(player))
      .send({ body: "Hello" })
      .expect(403);
  });
  it("removes comments automatically on challenge soft deletion and hides the thread", async () => {
    await request(app)
      .post(`/api/challenges/${challenge}/comments`)
      .set("Authorization", auth(player))
      .send({ body: "Hello" })
      .expect(201);
    await query("UPDATE challenges SET deleted_at = NOW() WHERE id = $1", [challenge]);
    expect((await query("SELECT * FROM challenge_comments")).rows).toHaveLength(0);
    await request(app).get(`/api/challenges/${challenge}/comments`).expect(404);
    await request(app)
      .post(`/api/challenges/${challenge}/comments`)
      .set("Authorization", auth(player))
      .send({ body: "Again" })
      .expect(404);
  });
  it("duplicates configuration and questions, resets escrow/dates/history, and audits the source", async () => {
    await query(
      "INSERT INTO challenge_questions (challenge_id, round, question_type, prompt_type, question_text, option_a, option_b, option_c, option_d, correct_option) VALUES ($1, 1, 'which_brand', 'logo', 'Which brand?', 'A', 'B', 'C', 'D', 'A')",
      [challenge]
    );
    await query(
      "INSERT INTO challenge_variants (challenge_id, name, question_config, status) VALUES ($1, 'Variant', '{\"rule\":true}', 'promoted')",
      [challenge]
    );
    await query(
      "INSERT INTO challenge_tiers (challenge_id, name, prize_pool_stroops) VALUES ($1, 'Gold', 1000000000)",
      [challenge]
    );
    await query(
      "INSERT INTO challenge_tag_map (challenge_id, tag_id) SELECT $1, id FROM challenge_tags LIMIT 1",
      [challenge]
    );
    await session(player, challenge);
    const response = await request(app)
      .post(`/api/challenges/${challenge}/duplicate`)
      .set("Authorization", auth(owner))
      .expect(201);
    const clone = response.body.challenge;
    expect(clone).toMatchObject({
      brand_id: brand,
      status: "draft",
      pool_amount_usdc: "100.0000000",
      starts_at: null,
      ends_at: null,
      deposit_memo: null,
      deposit_tx_hash: null,
      participant_count: 0,
      payout_tx_hashes: null,
    });
    expect(clone.id).not.toBe(challenge);
    expect(
      (
        await query("SELECT question_text FROM challenge_questions WHERE challenge_id = $1", [
          clone.id,
        ])
      ).rows
    ).toEqual([{ question_text: "Which brand?" }]);
    expect(
      (
        await query(
          "SELECT status, question_config FROM challenge_variants WHERE challenge_id = $1",
          [clone.id]
        )
      ).rows[0]
    ).toEqual({ status: "active", question_config: { rule: true } });
    expect(
      (await query("SELECT * FROM challenge_tiers WHERE challenge_id = $1", [clone.id])).rows
    ).toHaveLength(1);
    expect(
      (await query("SELECT * FROM challenge_tag_map WHERE challenge_id = $1", [clone.id])).rows
    ).toHaveLength(1);
    expect(
      (await query("SELECT * FROM game_sessions WHERE challenge_id = $1", [clone.id])).rows
    ).toHaveLength(0);
    expect(
      (await query("SELECT * FROM audit_log WHERE action = 'challenge.duplicated'")).rows
    ).toHaveLength(1);
  });
  it("denies duplication to non-owners, missing/deleted challenges, and anonymous users", async () => {
    await request(app)
      .post(`/api/challenges/${challenge}/duplicate`)
      .set("Authorization", auth(other))
      .expect(403);
    await request(app)
      .post(`/api/challenges/${randomUUID()}/duplicate`)
      .set("Authorization", auth(owner))
      .expect(404);
    await request(app).post(`/api/challenges/${challenge}/duplicate`).expect(401);
    await query("UPDATE challenges SET deleted_at = NOW() WHERE id = $1", [challenge]);
    await request(app)
      .post(`/api/challenges/${challenge}/duplicate`)
      .set("Authorization", auth(owner))
      .expect(404);
  });
  it("requires new dates before issuing fresh funding instructions and never activates the draft directly", async () => {
    const clone = await request(app)
      .post(`/api/challenges/${challenge}/duplicate`)
      .set("Authorization", auth(owner))
      .expect(201);
    const id = clone.body.challenge.id;
    await request(app)
      .post(`/api/challenges/${id}/publish-draft`)
      .set("Authorization", auth(owner))
      .send({})
      .expect(400);
    const body = {
      startsAt: new Date(Date.now() + 3600000).toISOString(),
      endsAt: new Date(Date.now() + 10800000).toISOString(),
    };
    await request(app)
      .post(`/api/challenges/${id}/publish-draft`)
      .set("Authorization", auth(other))
      .send(body)
      .expect(403);
    const result = await request(app)
      .post(`/api/challenges/${id}/publish-draft`)
      .set("Authorization", auth(owner))
      .send(body)
      .expect(200);
    expect(result.body.challenge.status).toBe("pending_deposit");
    expect(result.body.depositInstructions.memo).toBeTruthy();
    expect(result.body.depositInstructions.memo).not.toBe("old-memo");
    await request(app)
      .post(`/api/challenges/${id}/publish-draft`)
      .set("Authorization", auth(owner))
      .send(body)
      .expect(409);
  });
  it("round-trips all four new migrations", async () => {
    for (const file of [...newMigrations].reverse()) await apply(`${file}.down`);
    for (const file of newMigrations) await apply(file);
    expect((await query("SELECT status FROM waitlist")).rows[0].status).toBe("waiting");
    expect((await query("SELECT * FROM challenge_comments")).rows).toEqual([]);
  });
});
