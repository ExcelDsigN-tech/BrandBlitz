# ADR 003: Hand-Rolled SQL Migrations over an ORM Migration Tool (#68)

## Status

Accepted

## Context

The API runs against Postgres. The team evaluated three ways to
evolve the schema:

1. Drizzle / Kysely auto-migrations (generated from TypeScript models).
2. Prisma's `prisma migrate dev` workflow.
3. A hand-rolled migration runner that executes versioned SQL files.

We landed on a hand-rolled runner. This ADR captures why so a future
contributor doesn't ask "why isn't this Prisma?" and silently
re-litigate the decision.

## Decision

`apps/api/scripts/migrate.ts` runs versioned SQL files from
`apps/api/migrations/` against the configured database.

- Each migration is a numbered `.sql` file (`NNNN_<slug>.sql`).
- Up-direction only by default — Postgres-shaped, write-only.
  Down-migrations are added on a case-by-case basis when the
  reverting transformation is genuinely safe and short.
- The runner uses an advisory lock so two pods racing to migrate the
  same database produce one applied sequence, not corruption.
- A `migrations_history` table records every applied id + hash; the
  runner refuses to re-run a migration whose hash changed (catches
  hand-edits of already-applied files).

## Rationale

- **Auditable**: every schema change is a plain SQL file in git that
  reviewers can read end-to-end. ORM-generated migrations often
  obscure intent behind generated text.
- **Postgres-shaped**: we lean on Postgres features (partial
  indexes, RLS, expression indexes, `CHECK` constraints,
  `generated columns`) that ORM migration generators frequently
  emit as opaque escape hatches anyway.
- **No drift channel**: the schema lives in SQL files, not in a
  TypeScript model that has to be kept in lock-step. The runtime
  query layer ([sql-template-strings](https://www.npmjs.com/package/sql-template-strings)
  - a thin type generator) reads from the live schema.
- **Operational simplicity**: zero new third-party tools in the
  production runbook. `pnpm migrate` is just a thin wrapper around
  `psql`.

Considered alternatives:

- **Prisma migrate**: tempting because of the model-first DX, but
  adoption would force us to express our existing schema in
  `schema.prisma` then _generate_ migrations from it. Net loss in
  reviewability for non-trivial migrations.
- **Drizzle migrate**: similar trade-off; the generator is
  cleaner than Prisma's, but we still pay the model-first cost.
- **Knex migrations**: viable but pulls a runtime dep we don't
  otherwise need.

## Consequences

- Every schema change requires writing SQL. No magic table /
  column auto-creation. The team treats this as a feature, not a
  burden.
- `migrate.ts` is now load-bearing — bugs in the runner can corrupt
  prod. Tested via `pnpm migrate:dryrun` in CI on every PR that
  touches `apps/api/migrations/` (see `ci.yml` `test-api` job).
- Down migrations remain explicit and reviewed alongside their up
  counterpart. They are now additionally exercised in CI: the
  `exercise-down-migrations` job in `db-dual-path.yml` applies all
  forward migrations, rolls back each `.down.sql` file in reverse
  version order, re-applies the up migration, and asserts the schema
  matches the pre-rollback baseline (round-trip check). This
  validates every rollback code path before it is ever needed during
  a live incident.
- New contributors learn one tool (`pnpm migrate`) instead of two
  (an ORM model API + an ORM CLI).

## Addendum: duplicate prefixes (#951)

Two directories hold migrations. `apps/api/migrations/` is canonical: it's
what `migrate.ts` reads. The root `migrations/` is historical and frozen (see
`migrations/README.md`). The `NNNN_<slug>.sql` pattern above describes the
root directory; new files use `<NNNNN>-<kebab-slug>.sql` per
`docs/database/migrations.md`.

Both directories already contain numeric prefixes shared by more than one
file, compared as integers:

- `apps/api/migrations/`: 12 (`00012-*`, `0012-*`), 27 (two `00027-*`, two
  `0027-*`), 30 (`00030-*`, two `0030-*`).
- `migrations/`: 007, 011, 012, 014, 015, 018, 019.

Applied migrations can't be renamed without rewriting `schema_migrations`
everywhere, so these exact groups are grandfathered in
`apps/api/src/db/migration-lint.ts`. `migrate:lint` runs in CI and rejects
any new collision or any file added to an existing group.

## References

- `apps/api/scripts/migrate.ts`
- `apps/api/migrations/` (canonical), `migrations/` (historical)
- `apps/api/src/db/migration-lint.ts`
- Closes #68.

## Migration Directory Clarification

The migration runner reads **only** from `apps/api/migrations/`. A legacy `migrations/` directory exists at the repository root (39 files with 3-digit prefixes) but is **not used** by `pnpm migrate`, `pnpm migrate:dryrun`, or `pnpm migrate:down`. The root directory predates the current migration framework and is retained as a historical record.

**For contributors**: Always add new migrations to `apps/api/migrations/`, not the root `migrations/` directory.
