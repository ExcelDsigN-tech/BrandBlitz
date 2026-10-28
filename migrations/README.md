# Root migration sequence

The forward SQL files in this directory use one unique, zero-padded sequence
number. The numbers preserve the lexical execution order that existed before
issue #918; matching `.down.sql` files intentionally share their forward
migration's number.

The API migration runner uses `apps/api/migrations/`. This root directory is a
historical migration path still exercised by `db-dual-path.yml`. Operators who
have a custom deployment that records these root filenames in
`schema_migrations.version` must reconcile those stored filenames once, in the
same release that deploys the renames below. The two-step update avoids primary
key collisions between old names and new names:

```sql
BEGIN;

CREATE TEMP TABLE root_migration_renames (old_version TEXT, new_version TEXT)
ON COMMIT DROP;

INSERT INTO root_migration_renames VALUES
  ('007_fraud_flags_unique_constraint.sql', '008_fraud_flags_unique_constraint.sql'),
  ('008_session_integrity_hmac.sql', '009_session_integrity_hmac.sql'),
  ('009_challenges_end_after_start.sql', '010_challenges_end_after_start.sql'),
  ('010_app_config.sql', '011_app_config.sql'),
  ('011_game_sessions_user_completed_at_index.sql', '012_game_sessions_user_completed_at_index.sql'),
  ('011_payouts_error_message_not_null.sql', '013_payouts_error_message_not_null.sql'),
  ('011_pool_amount_stroops.sql', '014_pool_amount_stroops.sql'),
  ('011_product_image_keys.sql', '015_product_image_keys.sql'),
  ('011_question_types.sql', '016_question_types.sql'),
  ('011_round_scores_normalize.sql', '017_round_scores_normalize.sql'),
  ('011_username_unique_partial.sql', '018_username_unique_partial.sql'),
  ('011_users_muxed_id_partial_unique.sql', '019_users_muxed_id_partial_unique.sql'),
  ('012_drop_correct_answer.sql', '020_drop_correct_answer.sql'),
  ('012_fk_on_delete.sql', '021_fk_on_delete.sql'),
  ('013_check_constraints.sql', '022_check_constraints.sql'),
  ('014_gdpr_erasure.sql', '023_gdpr_erasure.sql'),
  ('014_users_username_and_session_abandoned.sql', '024_users_username_and_session_abandoned.sql'),
  ('015_fraud_flags_review_fields.sql', '025_fraud_flags_review_fields.sql'),
  ('015_referral_codes_and_payouts.sql', '026_referral_codes_and_payouts.sql'),
  ('016_refunds.sql', '027_refunds.sql'),
  ('017_user_status.sql', '028_user_status.sql'),
  ('018_challenge_pool_minimum.sql', '029_challenge_pool_minimum.sql'),
  ('018_league_recalculation_procedure.sql', '030_league_recalculation_procedure.sql'),
  ('018_payout_fraud_block_trigger.sql', '031_payout_fraud_block_trigger.sql'),
  ('019_brand_challenge_stats_view.sql', '032_brand_challenge_stats_view.sql'),
  ('019_users_last_login.sql', '033_users_last_login.sql'),
  ('020_question_preview_approved.sql', '034_question_preview_approved.sql'),
  ('021_notifications.sql', '035_notifications.sql'),
  ('022_fraud_flags_indexes.sql', '036_fraud_flags_indexes.sql'),
  ('023_idx_challenges_active_status.sql', '037_idx_challenges_active_status.sql'),
  ('024_idx_payouts_user_id.sql', '038_idx_payouts_user_id.sql'),
  ('025_idx_league_assignments_week_league.sql', '039_idx_league_assignments_week_league.sql'),
  ('026_challenge_licenses.sql', '040_challenge_licenses.sql'),
  ('027_experiments_moderation_and_league_weights.sql', '041_experiments_moderation_and_league_weights.sql'),
  ('028_weighted_league_recalculation.sql', '042_weighted_league_recalculation.sql'),
  ('029_challenge_reminders_and_api_keys.sql', '043_challenge_reminders_and_api_keys.sql');

UPDATE schema_migrations AS applied
SET version = 'issue-918:' || applied.version
FROM root_migration_renames AS rename
WHERE applied.version = rename.old_version;

UPDATE schema_migrations AS applied
SET version = rename.new_version
FROM root_migration_renames AS rename
WHERE applied.version = 'issue-918:' || rename.old_version;

COMMIT;
```

The unchanged `001` through `007_audit_log.sql` filenames need no
reconciliation.

## No new files

This directory is frozen. New schema changes go in
[`apps/api/migrations/`](../apps/api/migrations/README.md) with the next free
5-digit prefix. `pnpm --filter @brandblitz/api migrate:lint` (run in CI) fails
if two files here, or in `apps/api/migrations/`, share a numeric prefix.
