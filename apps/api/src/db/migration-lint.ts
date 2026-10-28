/**
 * Filename checks for migration directories (#951). Pure functions so they
 * can be unit-tested and reused by `scripts/migrate.ts lint`.
 */

/** Leading digits of a migration filename as an integer, or null if none. */
export function migrationPrefix(file: string): number | null {
  const match = /^(\d+)/.exec(file);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * Groups up-migration files by numeric prefix and returns only the prefixes
 * shared by more than one migration. `.down.sql` files are ignored, since
 * they pair with their up file rather than claiming a prefix. Prefixes are
 * compared as integers, so `0027-*` and `00027-*` collide.
 */
export function findDuplicatePrefixes(files: string[]): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const file of files) {
    if (!file.endsWith(".sql") || file.endsWith(".down.sql")) continue;
    const prefix = migrationPrefix(file);
    if (prefix === null) continue;
    groups.set(prefix, [...(groups.get(prefix) ?? []), file]);
  }

  const duplicates = new Map<number, string[]>();
  for (const [prefix, group] of groups) {
    if (group.length > 1) duplicates.set(prefix, group.sort());
  }
  return duplicates;
}

/**
 * Duplicate prefixes in apps/api/migrations that were applied before this
 * check existed. Applied migrations can't be renamed without rewriting
 * schema_migrations on every environment, so these exact groups are allowed.
 * Never add to this list: give a new migration the next free prefix instead.
 */
export const GRANDFATHERED_API_DUPLICATES: ReadonlyMap<number, readonly string[]> = new Map([
  [12, ["00012-cursor-pagination-indexes.sql", "0012-multisig-escrow.sql"]],
  [
    27,
    [
      "00027-league-and-session-scan-indexes.sql",
      "00027-users-onboarding-completed.sql",
      "0027-challenge-tags.sql",
      "0027-drop-correct-answer.sql",
    ],
  ],
  [28, ["0028-challenge-gallery.sql", "0028-notification-preferences.sql"]],
  [
    30,
    [
      "00030-fraud-score-override.sql",
      "0030-accessibility-timezone-refund-policy.sql",
      "0030-brand-digest-preferences.sql",
      "0030-challenge-ratings.sql",
    ],
  ],
  [31, ["00031-brand-members.sql", "00031-web-push-subscriptions.sql"]],
]);

/**
 * Duplicate prefixes in the frozen root `migrations/` directory. #918 gave
 * every root file its own prefix, so none are allowed; the check stays so a
 * collision can't come back.
 */
export const GRANDFATHERED_ROOT_DUPLICATES: ReadonlyMap<number, readonly string[]> = new Map();

/**
 * Returns one human-readable error per duplicate prefix that isn't an exact
 * match for its grandfathered group. Adding a file to an allowed group also
 * fails, so the allowlist can't silently grow.
 */
export function checkDuplicatePrefixes(
  files: string[],
  allowed: ReadonlyMap<number, readonly string[]>
): string[] {
  const errors: string[] = [];
  for (const [prefix, group] of findDuplicatePrefixes(files)) {
    const expected = [...(allowed.get(prefix) ?? [])].sort();
    const same = expected.length === group.length && expected.every((file, i) => file === group[i]);
    if (!same) {
      errors.push(`prefix ${prefix} is used by more than one migration: ${group.join(", ")}`);
    }
  }
  return errors;
}
