# Anti-Cheat Policy

This document outlines the rules and enforcement tiers for BrandBlitz anti-cheat systems.

## 1. Detection Signals

| Signal                   | Logic                                | Action           | Severity |
| :----------------------- | :----------------------------------- | :--------------- | :------- |
| **Bot Reaction**         | `reactionTimeMs < 80`                | Hard Block (403) | Critical |
| **Suspicious Reaction**  | `80 <= reactionTimeMs < 150`         | Record Flag      | Warning  |
| **Excessive Lag**        | `reactionTimeMs > 30000`             | Record Flag      | Info     |
| **Multi-Account Device** | `accounts_per_device >= 3` (per 24h) | Record Flag      | Warning  |

## 2. Enforcement Tiers

### Critical (Block)

Any activity meeting "Critical" thresholds is rejected immediately. The server returns a `403 Forbidden` error. The round data is discarded and not persisted to the database.

### Warning (Soft Flag)

Activities meeting "Warning" thresholds are allowed to complete. However:

- A `fraud_flag` is linked to the session.
- The session is marked as "Ineligible" for pool payouts.
- The user may be hidden from public competitive leaderboards.

## 3. Payout Eligibility

BrandBlitz strictly pays out only for "Clean" sessions. A session is eligible for a portion of the challenge pool ONLY IF it has zero associated fraud flags.

The worker process checks for the existence of any entries in the `fraud_flags` table for a given `session_id` before processing payouts.
