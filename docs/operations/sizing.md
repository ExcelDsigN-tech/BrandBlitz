# Service Sizing

These are the `deploy.resources.limits` entries in `docker-compose.yml`. They
stop one runaway service from starving the host.

| Service           |   CPU | Memory | Rationale                                                                                                                 |
| ----------------- | ----: | -----: | ------------------------------------------------------------------------------------------------------------------------- |
| `api`             | `1.0` |   `1G` | Validated by the load test below: about 25% of one CPU at peak and under 200 MB RSS at the baseline load.                 |
| `worker`          | `0.5` | `512M` | The payout worker is mostly I/O bound and should not compete with the API for host CPU. Not covered by the load test yet. |
| `deposit-monitor` | `0.5` | `256M` | Polls Soroban RPC every 5 s. Watch `deposit_monitor_indexer_lag_seconds` (see `deposit-monitor-slo.md`).                  |
| `web`             | `1.0` |   `1G` | Next.js SSR and image optimization can spike memory, so the cap keeps spikes bounded. Not covered by the load test yet.   |

## Load-test results

The `api` limits are backed by the k6 load test in
[`../perf/load-testing.md`](../perf/load-testing.md)
(`tests/load/challenge-play.js`), run on 2026-10-16.

**Setup.** The API was started in production mode (`NODE_ENV=production`,
default `DB_POOL_MAX=10`) and pinned to one CPU core with `taskset -c 0`,
equivalent to `cpus: "1.0"`. PostgreSQL 16 and Redis 7 ran on the same
4-core / 15 GB host, outside that core, with k6 pinned to two other cores.
The schema was built with `scripts/perf/prepare-loadtest-db.sh`. RSS and CPU
were sampled from `/proc` once per second.

**Baseline: 5 new players/s for 60 s** (about 125 concurrent players, 301
full sessions, 1,807 requests at about 21 req/s):

| Endpoint                    |     p50 |     p95 |     p99 |
| --------------------------- | ------: | ------: | ------: |
| `warmup-start`              |  8.5 ms | 15.6 ms | 31.1 ms |
| `warmup-complete`           |  6.1 ms | 12.4 ms | 29.8 ms |
| `start`                     |  8.2 ms | 14.0 ms | 32.5 ms |
| `answer` (rounds 1–2)       |  6.2 ms | 12.1 ms | 19.9 ms |
| `answer/3` (session submit) | 14.2 ms | 24.1 ms | 31.4 ms |

- Error rate 0.00%. All 301 sessions completed and every k6 threshold passed.
- API CPU averaged 11% of one core, with a 25% peak.
- API RSS peaked at 199 MB.

**Conclusion.** At this load, `cpus: "1.0"` / `1G` leaves about 4x CPU
headroom and about 5x memory headroom. No throttling was observed, so the
limits stay as they are. In a partial run at 20 players/s (about
500 concurrent), CPU reached about 76% of the core and RSS about 350 MB. That
is the level at which the API should be scaled out or given more CPU. See
`../perf/session-start-burst-investigation.md` for burst behaviour and the
`DB_POOL_MAX` ceiling.

## Re-validating

Re-run the load test when any of these change, then update the table above:

- the session code path,
- `DB_POOL_MAX`,
- these limits.

The `Load test` workflow (`.github/workflows/load-test.yml`) runs weekly and
on demand so regressions show up between manual runs. GitHub-hosted runner
numbers are noisier than the setup above, so compare CI runs with each
other, not with this table. `worker` and `web` are not exercised yet. Extend
the scenario before changing their limits.
