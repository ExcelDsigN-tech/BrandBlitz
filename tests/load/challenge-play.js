// k6 load test: challenge-play → session-submit (issue #958).
//
// Each iteration is one player completing a full competitive session:
//   POST /sessions/:id/warmup-start
//   ...  WARMUP_MIN_SECONDS (20 s) server-enforced warm-up
//   POST /sessions/:id/warmup-complete        → challengeToken
//   POST /sessions/:id/start
//   POST /sessions/:id/answer/{1,2,3}         (round 3 = session submit)
//
// GET /challenges/:id (the play page's detail fetch) is not exercised yet: on
// a schema built from the repo's SQL it returns 500 because
// getChallengeByIdAny() UNIONs `SELECT *` from challenges and
// challenges_archive, whose columns have drifted apart. Add it back once that
// is fixed. See docs/perf/load-testing.md.
//
// Prerequisite: `pnpm loadtest:seed -- --users <RATE × DURATION_SECONDS × 1.1>`
// writes tests/load/.data/fixture.json with one pre-authenticated player per
// iteration (the API allows one competitive session per user per challenge).
//
// Run: `pnpm loadtest` (see docs/perf/load-testing.md for env vars and how to
// read the output).

import http from "k6/http";
import exec from "k6/execution";
import { check, fail, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const FIXTURE_PATH = __ENV.FIXTURE || "./.data/fixture.json";
const RATE = Number(__ENV.LOADTEST_RATE || 5); // new players per second
const DURATION = __ENV.LOADTEST_DURATION || "60s";
const WARMUP_SECONDS = Number(__ENV.WARMUP_SECONDS || 20); // WARMUP_MIN_SECONDS in @brandblitz/stellar
const SUMMARY_PATH = __ENV.SUMMARY_PATH || "tests/load/.data/summary.json";

const fixture = new SharedArray("fixture", () => [JSON.parse(open(FIXTURE_PATH))]);
const users = new SharedArray("users", () => JSON.parse(open(FIXTURE_PATH)).users);

const sessionsCompleted = new Counter("sessions_completed");
const sessionDuration = new Trend("session_e2e_duration", true);
const fixtureExhausted = new Rate("fixture_exhausted");

// Each iteration lasts ~WARMUP_SECONDS + ~5 s of think time and requests.
const ITERATION_SECONDS = WARMUP_SECONDS + 10;
const ENDPOINTS = ["warmup_start", "warmup_complete", "session_start", "answer", "session_submit"];

// Per-endpoint latency budget (ms) as [p95, p99]. Values come from the
// baseline in docs/operations/sizing.md; a breach makes k6 exit non-zero.
const LATENCY_BUDGET = {
  warmup_start: [300, 800],
  warmup_complete: [300, 800],
  session_start: [300, 800],
  answer: [300, 800],
  session_submit: [500, 1000],
};

const thresholds = {
  http_req_failed: ["rate<0.01"],
  checks: ["rate>0.99"],
  fixture_exhausted: ["rate==0"],
};
for (const endpoint of ENDPOINTS) {
  const [p95, p99] = LATENCY_BUDGET[endpoint];
  thresholds[`http_req_duration{endpoint:${endpoint}}`] = [`p(95)<${p95}`, `p(99)<${p99}`];
  // Always-true threshold so the per-endpoint request count is in the summary.
  thresholds[`http_reqs{endpoint:${endpoint}}`] = ["count>=0"];
}

export const options = {
  scenarios: {
    challenge_play: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: Math.ceil(RATE * ITERATION_SECONDS * 1.2),
      maxVUs: Math.ceil(RATE * ITERATION_SECONDS * 2),
      gracefulStop: `${ITERATION_SECONDS + 10}s`,
    },
  },
  summaryTrendStats: ["avg", "min", "med", "p(50)", "p(95)", "p(99)", "max"],
  thresholds,
};

function params(token, endpoint) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // Unique device per player so the multi-account fingerprint check
      // (3+ accounts per fingerprint → 403) does not trip.
      "X-Device-Id": `k6-${exec.vu.idInTest}-${exec.scenario.iterationInTest}`,
      "User-Agent": "brandblitz-k6-loadtest",
      // requireHttps rejects plain HTTP in production unless a TLS-terminating
      // proxy sets this; nginx overwrites it when present.
      "X-Forwarded-Proto": "https",
    },
    tags: { endpoint },
  };
}

function durationSeconds(value) {
  const match = /^(\d+(?:\.\d+)?)(s|m|h)$/.exec(value);
  if (!match) fail(`LOADTEST_DURATION must look like 60s, 5m or 1h (got "${value}")`);
  return Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2]];
}

function thinkTime(minSeconds, maxSeconds) {
  sleep(minSeconds + Math.random() * (maxSeconds - minSeconds));
}

export function setup() {
  if (users.length < 1) fail(`No users in ${FIXTURE_PATH}; run pnpm loadtest:seed first`);
  const needed = Math.ceil(RATE * durationSeconds(DURATION) * 1.1);
  if (users.length < needed) {
    fail(`Fixture has ${users.length} players but rate ${RATE}/s × ${DURATION} needs ~${needed}; re-seed with --users ${needed}`);
  }
  // /health returns 503 "degraded" when only Stellar is unreachable, which
  // does not affect this path; require the database and Redis to be up.
  const res = http.get(`${BASE_URL}/health`, {
    headers: { "X-Forwarded-Proto": "https" },
    tags: { endpoint: "setup" },
    // Keep the readiness probe out of http_req_failed.
    responseCallback: http.expectedStatuses(200, 503),
  });
  let body = {};
  try {
    body = res.json();
  } catch (_) {
    // fall through to the failure below
  }
  if (body.db !== "ok" || body.redis !== "ok") {
    fail(`API at ${BASE_URL} is not ready (GET /health → ${res.status} ${res.body})`);
  }
}

export default function () {
  const index = exec.scenario.iterationInTest;
  if (index >= users.length) {
    fixtureExhausted.add(1);
    return;
  }
  fixtureExhausted.add(0);

  const { token } = users[index];
  const challengeId = fixture[0].challengeId;
  const startedAt = Date.now();

  const warmupStart = http.post(
    `${BASE_URL}/sessions/${challengeId}/warmup-start`,
    JSON.stringify({}),
    params(token, "warmup_start")
  );
  if (!check(warmupStart, { "warmup-start 200": (r) => r.status === 200 })) return;

  sleep(WARMUP_SECONDS + 0.5);

  const warmupComplete = http.post(
    `${BASE_URL}/sessions/${challengeId}/warmup-complete`,
    JSON.stringify({ clientTimestamp: Date.now() }),
    params(token, "warmup_complete")
  );
  if (!check(warmupComplete, { "warmup-complete 200": (r) => r.status === 200 })) return;
  const challengeToken = warmupComplete.json("challengeToken");

  const start = http.post(
    `${BASE_URL}/sessions/${challengeId}/start`,
    JSON.stringify({ challengeToken }),
    params(token, "session_start")
  );
  if (!check(start, { "session start 200": (r) => r.status === 200 })) return;

  for (const round of [1, 2, 3]) {
    thinkTime(1, 2.5);
    const endpoint = round === 3 ? "session_submit" : "answer";
    const answer = http.post(
      `${BASE_URL}/sessions/${challengeId}/answer/${round}`,
      JSON.stringify({
        selectedOption: ["A", "B", "C", "D"][Math.floor(Math.random() * 4)],
        reactionTimeMs: 800 + Math.floor(Math.random() * 2500),
      }),
      params(token, endpoint)
    );
    if (!check(answer, { [`answer round ${round} 200`]: (r) => r.status === 200 })) return;
  }

  sessionsCompleted.add(1);
  sessionDuration.add(Date.now() - startedAt);
}

function fmt(value) {
  return value === undefined ? "-" : `${value.toFixed(1)}ms`;
}

export function handleSummary(data) {
  const rows = [];
  const header = "endpoint".padEnd(18) + ["count", "p50", "p95", "p99", "max"].map((h) => h.padStart(11)).join("");
  for (const endpoint of ENDPOINTS) {
    const metric = data.metrics[`http_req_duration{endpoint:${endpoint}}`];
    const count = data.metrics[`http_reqs{endpoint:${endpoint}}`];
    if (!metric) continue;
    const v = metric.values;
    rows.push(
      endpoint.padEnd(18) +
        String(count ? count.values.count : "-").padStart(11) +
        [v["p(50)"], v["p(95)"], v["p(99)"], v.max].map((x) => fmt(x).padStart(11)).join("")
    );
  }

  const failed = data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate : 0;
  const reqs = data.metrics.http_reqs ? data.metrics.http_reqs.values : { count: 0, rate: 0 };
  const completed = data.metrics.sessions_completed ? data.metrics.sessions_completed.values.count : 0;
  const breached = Object.entries(data.metrics)
    .filter(([, m]) => m.thresholds && Object.values(m.thresholds).some((t) => !t.ok))
    .map(([name]) => name);

  const text = [
    "",
    "BrandBlitz load test: challenge-play → session-submit",
    `target: ${BASE_URL}   rate: ${RATE}/s   duration: ${DURATION}`,
    "",
    header,
    ...rows,
    "",
    `requests: ${reqs.count} (${reqs.rate.toFixed(1)}/s)   error rate: ${(failed * 100).toFixed(2)}%   sessions completed: ${completed}`,
    breached.length ? `THRESHOLDS BREACHED: ${breached.join(", ")}` : "All thresholds passed.",
    "",
  ].join("\n");

  return {
    stdout: text,
    [SUMMARY_PATH]: JSON.stringify(data, null, 2),
  };
}
