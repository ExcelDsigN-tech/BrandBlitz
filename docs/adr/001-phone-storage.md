# ADR 001: Store Hashed Phone Numbers Instead Of Raw Numbers

## Status

Accepted

## Context

BrandBlitz verifies phone ownership with Twilio, but the database schema drifted: the application code expected a `phone_hash` column while the schema still exposed `phone_number`.

Phone numbers are highly sensitive personal data. A raw phone number in the database increases the blast radius of a database leak because attackers can directly re-identify users, target them with phishing, or correlate accounts with external datasets.

## Decision

BrandBlitz will store a one-way HMAC hash of a normalized phone number instead of the raw phone number.

- Canonical form: normalized E.164 string, for example `+15551234567`
- Algorithm: HMAC-SHA256
- Secret salt / pepper: `PHONE_HASH_SALT`
- Stored fields:
  - `phone_hash TEXT`
  - `phone_verified BOOLEAN`
  - `phone_verified_at TIMESTAMPTZ`

The application verifies ownership with Twilio first, then hashes the normalized number before writing it to PostgreSQL.

## Rationale

- Better privacy posture: the database no longer contains directly usable phone numbers.
- Stronger breach resistance: a keyed HMAC prevents straightforward rainbow-table or dictionary reversal if the database leaks without application secrets.
- Functional parity: the hash still supports uniqueness checks and “already used by another account” enforcement.

## Consequences

- Support tooling can no longer read the user’s phone number from PostgreSQL directly.
- The `PHONE_HASH_SALT` secret must be managed like other application secrets.
- The hashed-phone shape is part of the **baseline schema snapshot**, not a
  forward migration. `apps/api/migrations/00000-initial.sql` creates the
  `users` table with `phone_hash TEXT UNIQUE`, `phone_verified BOOLEAN NOT NULL
DEFAULT FALSE` and `phone_verified_at TIMESTAMPTZ`, plus
  `idx_users_phone_hash`. It has no `phone_number` column. Any database built
  from `init.sql` or `pnpm --filter @brandblitz/api migrate` already matches
  this ADR, and there is nothing further to apply.
- **Known gap: no forward migration exists in the live migration tree.** The
  `phone_number` → `phone_hash` transition this ADR originally described lives
  only in `migrations/001_phone_storage_schema.sql`, under the root
  `migrations/` directory. `apps/api/scripts/migrate.ts` reads only
  `apps/api/migrations/`, so `pnpm migrate` never runs that file (see issue
  #948, the two-migrations-directories problem). An environment created
  _before_ the baseline snapshot that still has a `phone_number` column will
  not be upgraded automatically. It must apply
  `migrations/001_phone_storage_schema.sql` by hand (`psql -f`), then confirm
  that `phone_number` is gone and `phone_hash` / `phone_verified_at` exist. If
  such environments still exist, this should be turned into a real
  `apps/api/migrations/` file. None is known at the time of writing.

## References

- `apps/api/migrations/00000-initial.sql`: baseline snapshot. The `users`
  table definition there is the source of truth for this ADR's columns
  (verified: `phone_hash` and `phone_verified_at` are present, `phone_number`
  is absent).
- `apps/api/scripts/migrate.ts`: the migration runner. It reads only
  `apps/api/migrations/`.
- `migrations/001_phone_storage_schema.sql`: historical, **not executed** by
  the migration runner. Kept only as a manual upgrade path for pre-baseline
  databases (see Consequences).
- Issue #948: root `migrations/` vs `apps/api/migrations/` confusion.
- `apps/api/src/db/queries/users.ts`: reads and writes `phone_hash`.
- `docs/guides/phone-verification.md`
- Issue #960: correction of this ADR's migration reference.
