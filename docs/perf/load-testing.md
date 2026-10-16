# Load testing

BrandBlitz has one k6 load test. It drives the competitive
**challenge-play → session-submit** path with many concurrent players and
reports p50/p95/p99 latency per endpoint plus the overall error rate
(issue #958). Its results back the resource limits in
[`../operations/sizing.md`](../operations/sizing.md).

| File                                                                               | Purpose                                                           |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`tests/load/challenge-play.js`](../../tests/load/challenge-play.js)               | k6 scenario, thresholds and summary output                        |
| [`scripts/perf/seed-load-test.ts`](../../scripts/perf/seed-load-test.ts)           | Seeds an active challenge and N players with signed access tokens |
| [`scripts/perf/prepare-loadtest-db.sh`](../../scripts/perf/prepare-loadtest-db.sh) | Builds a throwaway database schema the API can run against        |
| [`.github/workflows/load-test.yml`](../../.github/workflows/load-test.yml)         | Weekly and manual CI run                                          |

## What the scenario does

Each k6 iteration is one player playing one full competitive session, with
human-like pauses:

1. `POST /sessions/:challengeId/warmup-start`
2. Waits out the server-enforced warm-up (`WARMUP_MIN_SECONDS`, 20 s)
3. `POST /sessions/:challengeId/warmup-complete` returns a challenge token
4. `POST /sessions/:challengeId/start`
5. `POST /sessions/:challengeId/answer/1` and `answer/2` (1 to 2.5 s apart)
6. `POST /sessions/:challengeId/answer/3`, the **session submit**: it scores
   the session, finishes it, updates streaks and badges, and invalidates the
   leaderboard cache

New players arrive at a constant rate (`LOADTEST_RATE` per second, k6
`constant-arrival-rate` executor). Because each player spends about 25 s in a
session, the number of concurrent players is about `25 × LOADTEST_RATE`. The
default (5 per second for 60 s) holds about 125 concurrent players and
starts 300 sessions.

Every player gets its own account, access token and `X-Device-Id`. The API
allows one competitive session per user per challenge, rate-limits per user,
and rejects devices shared by three or more accounts, so the seed step
creates one account per iteration.

`GET /challenges/:id`, the play page's detail fetch, is **not** exercised
yet. On a schema built from the repo's SQL it returns 500:
`getChallengeByIdAny()` runs `SELECT * … UNION ALL SELECT * FROM
challenges_archive`, and the two tables no longer have the same columns. Add
it back to the scenario once that is fixed.

## Running it locally

Prerequisites: [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) on
`PATH` (it is a standalone binary, not an npm dependency), PostgreSQL, Redis,
and the API's usual environment variables (`.env`).

```bash
# 1. A throwaway database. Never point this at a database you care about.
createdb brandblitz_loadtest
DATABASE_URL=postgresql://brandblitz:brandblitz_dev@localhost:5432/brandblitz_loadtest \
  scripts/perf/prepare-loadtest-db.sh

# 2. Start the API against that database, in production mode so logging and
#    middleware match what ships.
NODE_ENV=production DATABASE_URL=... pnpm --filter @brandblitz/api exec tsx src/index.ts

# 3. Seed players. You need about rate × seconds × 1.1 of them.
#    Access tokens expire after 15 minutes, so seed right before each run.
#    --lift-ip-rate-limit: see "The IP rate limit" below.
pnpm loadtest:seed -- --users 330 --lift-ip-rate-limit
sleep 11   # the API re-reads the rate limit at most every 10 s

# 4. Run k6.
pnpm loadtest
```

To reproduce the resource limits, constrain the API the way Compose does.
For example, run it with `taskset -c 0` for one CPU, or run the Compose
`api` service and point `BASE_URL` at it.

Why not `pnpm --filter @brandblitz/api migrate`? On a fresh database the
runner sorts migration files as strings, so `00012-…` runs before `0007-…`
and fails. The API also reads tables (for example `challenge_variants`) that
only the root `migrations/` directory creates, and the runner never applies
that directory (issue #948). `prepare-loadtest-db.sh` applies `init.sql`,
then `apps/api/migrations/`, then root `migrations/`, all in numeric order.
It logs any file that does not apply and fails only if a table the scenario
needs is missing.

### The IP rate limit

The global `apiLimiter` (`apps/api/src/middleware/rate-limit.ts`) is mounted
in `apps/api/src/index.ts` _before_ the routers, so `authenticate` has not run
yet and `req.user` is always unset. Every request is therefore keyed by
client IP, not by user, with a default budget of 200 requests per 15 minutes.
A load generator is a single IP, so without `--lift-ip-rate-limit` most
requests get `429` within seconds. The flag sets the runtime-tunable
`app_config` key `rate_limit_requests_per_minute` to 1,000,000 on the
load-test database. Never run it against a shared database.

The per-user key the limiter was written for never takes effect. That is
worth fixing separately, because in production every player behind the same
NAT or proxy IP shares one 200-request bucket.

### Configuration

| Variable            | Default                         | Meaning                                                                         |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `BASE_URL`          | `http://localhost:3001`         | API origin. Behind nginx, use `http://localhost/api`.                           |
| `LOADTEST_RATE`     | `5`                             | New players per second                                                          |
| `LOADTEST_DURATION` | `60s`                           | Arrival window (`s`, `m` or `h`). Sessions still in flight get up to 40 s more. |
| `WARMUP_SECONDS`    | `20`                            | Must match `WARMUP_MIN_SECONDS` in `@brandblitz/stellar`                        |
| `FIXTURE`           | `./.data/fixture.json`          | Seed output, relative to `tests/load/`                                          |
| `SUMMARY_PATH`      | `tests/load/.data/summary.json` | Full k6 JSON summary                                                            |
| `LOADTEST_USERS`    | `330`                           | Seed size when `--users` is not given                                           |

The `tests/load/.data/` directory is gitignored. It holds live access tokens.

## Which environment to run it against

| Environment                                         | Use it for                                                                                   | Notes                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Local, with the API pinned to the Compose CPU limit | Validating `docs/operations/sizing.md` and before/after comparisons for a performance change | The numbers in `sizing.md` come from this setup                                                   |
| CI (`load-test.yml`)                                | Catching regressions over time                                                               | GitHub-hosted runners are noisy shared VMs. Compare runs with each other, not with local numbers. |
| Staging                                             | Capacity checks with real nginx, TLS and network hops                                        | Seed against the staging database only. The seed creates real rows.                               |
| Production                                          | **Never**                                                                                    | The seed writes users, a brand and a challenge                                                    |

## Reading the output

k6 prints a table like this, then exits non-zero if any threshold is breached:

```text
BrandBlitz load test: challenge-play → session-submit
target: http://localhost:3001   rate: 5/s   duration: 60s

endpoint                count        p50        p95        p99        max
warmup_start              ...
...
session_submit            ...

requests: ... (.../s)   error rate: 0.00%   sessions completed: ...
All thresholds passed.
```

The thresholds, from `tests/load/challenge-play.js`, are:

| Metric                  | Budget                                  |
| ----------------------- | --------------------------------------- |
| `http_req_failed`       | below 1%                                |
| `checks`                | above 99% pass                          |
| Each step except submit | p95 under 300 ms, p99 under 800 ms      |
| `session_submit`        | p95 under 500 ms, p99 under 1000 ms     |
| `fixture_exhausted`     | 0. Every iteration had a seeded player. |

## When the test fails

1. **`fixture_exhausted` or a setup error about too few players**: the test
   is misconfigured, not the API. Re-seed with the `--users` value the error
   prints.
2. **`checks` / `http_req_failed` breached**: requests are failing. Look in
   the API log (`api.log` in the CI artifact) for the status codes.
   - `401`: the tokens expired. Seed again right before running.
   - `429`: a rate limiter tripped. If the API log shows
     `"limiter":"apiLimiter","key":"ip:…"`, the seed ran without
     `--lift-ip-rate-limit`, or k6 started within 10 s of seeding.
   - `403 FINGERPRINT_COLLISION`: device IDs are being reused.
   - `500` / `503`: real failures. The usual cause under load is PostgreSQL
     pool exhaustion (`timeout exceeded when trying to connect`; see
     `session-start-burst-investigation.md`).
3. **Only latency thresholds breached**: compare against the baseline in
   `sizing.md`.
   - If one endpoint regressed, look at what changed on its code path. The
     submit step does the most work.
   - If every endpoint regressed together, the API is CPU-bound or waiting
     for the DB pool. Check whether the API container is CPU-throttled
     (`docker stats`, `cpu.stat` `nr_throttled`) and `db_pool_waiting_clients`
     on `GET /metrics`.
   - If it reproduces on a quiet machine, treat it as a regression. If it
     only happens on a CI runner, re-run before acting. Shared runners vary
     by ±30%.
4. When a change makes the API faster or slower on purpose, re-run locally,
   update the baseline table in `sizing.md`, and only then adjust the
   thresholds in `challenge-play.js`.
