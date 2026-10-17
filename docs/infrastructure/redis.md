# Redis Infrastructure

## Overview

BrandBlitz runs a single Redis 7 instance that is shared by:

- **BullMQ** — payout and league job queues
- **Rate-limit counters** — sliding-window counters set with short TTLs
- **Anti-cheat locks** — short-lived distributed locks

## Memory configuration

| Setting            | Value          | Rationale                                                                                                                                                                                                                   |
| ------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxmemory`        | `1gb`          | Provides enough headroom for BullMQ job payloads alongside rate-limit and lock keys.                                                                                                                                        |
| `maxmemory-policy` | `volatile-lru` | Only keys that have an explicit TTL are eligible for eviction. BullMQ job keys have **no TTL**, so they are never silently discarded under memory pressure. Rate-limit counters and locks carry TTLs and are safe to evict. |

### Why not `allkeys-lru`?

The previous setting (`allkeys-lru`) treated all keys as eviction candidates. Under sustained traffic, Redis would evict BullMQ payout jobs (low access frequency) before hot rate-limit counters — causing **silent payout loss** with no error logged.

`volatile-lru` eliminates this risk: only TTL-bearing keys are eligible for eviction.

## Eviction monitoring

The worker process polls `INFO stats` every 60 seconds and emits a `redis_evicted_keys_total` log entry whenever the counter increments:

```json
{
  "level": "warn",
  "metric": "redis_evicted_keys_total",
  "value": 3,
  "total": 15
}
```

**Alert rule**: any non-zero delta should page on-call. Evictions under `volatile-lru` mean TTL-bearing keys (rate limiters, locks) are being recycled faster than they expire — a sign of memory pressure that needs investigation.

## Persistence

Append-only file (`--appendonly yes`) is enabled to survive container restarts without data loss. The `redis_data` Docker volume persists the AOF across restarts.

## Scaling

If Redis memory pressure becomes persistent even at 1 GB, consider splitting BullMQ onto a dedicated Redis instance (separate `BULLMQ_REDIS_URL` env var) so rate-limit and lock traffic cannot compete with job storage.
