/**
 * Seeds the data the k6 load test (tests/load/challenge-play.js) needs:
 * one active challenge with three rounds of questions, and N throwaway
 * players with freshly signed access tokens.
 *
 * Each virtual-user iteration in k6 consumes one player, because the API
 * allows a single competitive session per user per challenge.
 *
 * Usage (from the repo root, with the same env the API runs with):
 *   pnpm loadtest:seed -- --users 330 [--lift-ip-rate-limit]
 *
 * --lift-ip-rate-limit raises the `rate_limit_requests_per_minute` app_config
 * row. The global apiLimiter runs before route-level authentication, so it
 * keys every request by client IP (default 200 requests / 15 min). A single
 * load generator is one IP and would otherwise be throttled almost at once.
 * The API re-reads the value at most every 10 s. Throwaway databases only.
 *
 * Writes tests/load/.data/fixture.json (gitignored). Access tokens are valid
 * for 15 minutes (ACCESS_TOKEN_TTL), so run k6 straight after seeding.
 *
 * See docs/perf/load-testing.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pool, query } from "../../apps/api/src/db";
import { createBrand } from "../../apps/api/src/db/queries/brands";
import { insertChallengeQuestions } from "../../apps/api/src/db/queries/challenges";
import { signAccessToken } from "../../apps/api/src/lib/tokens";

const OUTPUT_PATH = path.resolve(__dirname, "../../tests/load/.data/fixture.json");

function parseUsers(argv: string[]): number {
  const index = argv.indexOf("--users");
  const raw = index >= 0 ? argv[index + 1] : process.env.LOADTEST_USERS;
  // Default matches the k6 defaults: 5 players/s × 60 s, plus 10% headroom.
  const users = raw ? Number.parseInt(raw, 10) : 330;
  if (!Number.isInteger(users) || users < 1 || users > 50_000) {
    throw new Error(`--users must be an integer between 1 and 50000 (got "${raw}")`);
  }
  return users;
}

async function seed(): Promise<void> {
  const argv = process.argv.slice(2);
  const userCount = parseUsers(argv);
  const runId = `lt${Date.now().toString(36)}`;
  console.log(`🌱 Seeding load-test run ${runId} with ${userCount} players...`);

  const owner = await query<{ id: string }>(
    `INSERT INTO users (email, google_id, display_name, username, role)
     VALUES ($1, $2, 'Load Test Owner', $3, 'brand')
     RETURNING id`,
    [`${runId}-owner@loadtest.invalid`, `${runId}-owner`, `${runId}_owner`]
  );

  const brand = await createBrand({
    owner_user_id: owner.rows[0].id,
    name: `Load Test Brand ${runId}`,
    logo_url: "https://placehold.co/400x400?text=LT",
    primary_color: "#6366f1",
    secondary_color: "#1e293b",
    tagline: "Built to be hammered",
    brand_story: "Synthetic brand created by scripts/perf/seed-load-test.ts.",
    usp: "Throughput",
    product_image_keys: ["load-test-product"],
  });

  // Plain INSERT on baseline columns only (apps/api/migrations/00000-initial.sql)
  // so seeding works on any schema the canonical migration tree produces.
  // 100 USDC = 1,000,000,000 stroops.
  const challengeResult = await query<{ id: string }>(
    `INSERT INTO challenges (brand_id, challenge_id, deposit_memo, pool_amount_stroops, status)
     VALUES ($1, $2, $2, 1000000000, 'active')
     RETURNING id`,
    [brand.id, `${runId}-challenge`]
  );
  const challenge = challengeResult.rows[0];

  const options = { option_a: "A", option_b: "B", option_c: "C", option_d: "D" };
  await insertChallengeQuestions([
    {
      challenge_id: challenge.id,
      round: 1,
      question_type: "which_brand",
      prompt_type: "logo",
      question_text: "Which brand is this?",
      ...options,
      correct_option: "A",
    },
    {
      challenge_id: challenge.id,
      round: 2,
      question_type: "which_tagline",
      prompt_type: "tagline",
      question_text: "Which tagline?",
      ...options,
      correct_option: "B",
    },
    {
      challenge_id: challenge.id,
      round: 3,
      question_type: "which_product",
      prompt_type: "productImage1",
      question_text: "Which product?",
      ...options,
      correct_option: "C",
    },
  ] as Parameters<typeof insertChallengeQuestions>[0]);

  const players = await query<{ id: string; email: string }>(
    `INSERT INTO users (email, google_id, display_name, username)
     SELECT $1 || '-p' || n || '@loadtest.invalid',
            $1 || '-p' || n,
            'Load Test Player ' || n,
            $1 || '_p' || n
       FROM generate_series(1, $2::int) AS n
     RETURNING id, email`,
    [runId, userCount]
  );

  if (argv.includes("--lift-ip-rate-limit")) {
    await query(
      `INSERT INTO app_config (key, value) VALUES ('rate_limit_requests_per_minute', '{"limit": 1000000}')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
    );
    console.log(
      "⚠️  Raised app_config.rate_limit_requests_per_minute to 1,000,000 (load-test databases only)"
    );
  }

  const fixture = {
    runId,
    createdAt: new Date().toISOString(),
    challengeId: challenge.id,
    users: players.rows.map((user) => ({
      id: user.id,
      token: signAccessToken({ id: user.id, email: user.email, role: "player" }),
    })),
  };

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(fixture));
  console.log(
    `✅ Wrote ${fixture.users.length} players for challenge ${challenge.id} to ${OUTPUT_PATH}`
  );
}

seed()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("❌ Load-test seeding failed:", error);
    await pool.end().catch(() => {});
    process.exit(1);
  });
