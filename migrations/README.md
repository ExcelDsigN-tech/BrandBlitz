# Legacy Migration Directory (Not Used)

⚠️ **This directory is not read by the migration runner.**

The active migration directory is **`apps/api/migrations/`**, which is read by:
- `pnpm migrate`
- `pnpm migrate:dryrun`  
- `pnpm migrate:down`

## Background

This `migrations/` directory at the repository root contains 39 migration files with 3-digit prefixes (e.g., `001_phone_storage_schema.sql`). It predates the current migration framework documented in `docs/adr/003-migrations-framework.md`.

The migration runner (`apps/api/scripts/migrate.ts`) resolves its migrations directory as `path.resolve(__dirname, '../migrations')` from `apps/api/scripts/`, which resolves to `apps/api/migrations/`, not this root directory.

## What to Do

**If you want to add a new migration:**
- Add it to `apps/api/migrations/` following the naming convention documented in `docs/database/migrations.md`

**If you're wondering about these files:**
- They are retained as a historical record
- They are not applied by the current migration system
- Refer to `docs/adr/003-migrations-framework.md` for the current migration strategy

## Disposition Decision

This directory is **kept as a historical record** and will not be deleted. It provides context for the project's schema evolution but plays no role in the active migration workflow.
