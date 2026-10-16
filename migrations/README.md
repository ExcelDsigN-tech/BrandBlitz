# Root `migrations/` (historical, frozen)

This directory is **historical**. It predates the migration runner in
`apps/api/scripts/migrate.ts`, which only reads
[`apps/api/migrations/`](../apps/api/migrations/README.md). That directory is
the canonical home for schema changes.

Do not add, rename, or edit files here. New schema changes go in
`apps/api/migrations/` with the next free 5-digit prefix.

The files stay because `.github/workflows/db-dual-path.yml` still replays them
in sorted order to compare against `init.sql`, and renaming them would change
that order.

## Duplicate prefixes

Several files here share a numeric prefix. Within each group, apply order is
decided by the rest of the filename, not by the number:

| Prefix | Files                                                                                                                                                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 007    | `007_audit_log.sql`, `007_fraud_flags_unique_constraint.sql`                                                                                                                                                                                                                                   |
| 011    | `011_game_sessions_user_completed_at_index.sql`, `011_payouts_error_message_not_null.sql`, `011_pool_amount_stroops.sql`, `011_product_image_keys.sql`, `011_question_types.sql`, `011_round_scores_normalize.sql`, `011_username_unique_partial.sql`, `011_users_muxed_id_partial_unique.sql` |
| 012    | `012_drop_correct_answer.sql`, `012_fk_on_delete.sql`                                                                                                                                                                                                                                          |
| 014    | `014_gdpr_erasure.sql`, `014_users_username_and_session_abandoned.sql`                                                                                                                                                                                                                         |
| 015    | `015_fraud_flags_review_fields.sql`, `015_referral_codes_and_payouts.sql`                                                                                                                                                                                                                      |
| 018    | `018_challenge_pool_minimum.sql`, `018_league_recalculation_procedure.sql`, `018_payout_fraud_block_trigger.sql`                                                                                                                                                                               |
| 019    | `019_brand_challenge_stats_view.sql`, `019_users_last_login.sql`                                                                                                                                                                                                                               |

These groups are allowlisted in `apps/api/src/db/migration-lint.ts`.
`pnpm --filter @brandblitz/api migrate:lint` (run in CI) fails if any group
grows or a new collision appears, here or in `apps/api/migrations/`.

See [ADR 003](../docs/adr/003-migrations-framework.md) for background.
