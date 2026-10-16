#!/usr/bin/env bash
# Builds a load-test database schema from the repo's SQL (issue #958).
#
# Why not `pnpm --filter @brandblitz/api migrate`? On a fresh database the
# runner applies apps/api/migrations/ in lexicographic order, so
# 00012-cursor-pagination-indexes.sql runs before 0007-archive-tables.sql and
# fails. The API also reads tables that only exist in the root migrations/
# directory (for example challenge_variants), which the runner never applies
# (issue #948). Until those are fixed, this script applies:
#
#   1. init.sql (baseline snapshot + 00001)
#   2. apps/api/migrations/*.sql in numeric order (skipping .down.sql)
#   3. migrations/*.sql (root) in numeric order
#
# Each file runs in its own transaction (files using CREATE INDEX CONCURRENTLY
# are retried outside one). A file that fails is reported and
# skipped, because several files are not idempotent against the baseline
# snapshot. The script fails only if the tables the load-test path needs are
# missing at the end.
#
# Usage: DATABASE_URL=postgresql://... scripts/perf/prepare-loadtest-db.sh
# Point it at a throwaway database only. It is not a migration tool.
set -uo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
cd "$(dirname "$0")/../.."

numeric_sort() {
  python3 -c '
import os, re, sys
files = [line.strip() for line in sys.stdin if line.strip()]
key = lambda f: (int(re.match(r"\d+", os.path.basename(f)).group()), f)
print("\n".join(sorted(files, key=key)))
'
}

apply() {
  local file="$1" output
  if output=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$file" 2>&1); then
    echo "applied  $file"
  elif grep -q "CONCURRENTLY cannot run inside a transaction block" <<<"$output" &&
    output=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$file" 2>&1); then
    echo "applied  $file (outside a transaction: CREATE INDEX CONCURRENTLY)"
  else
    echo "skipped  $file: $(grep -m1 ERROR <<<"$output")"
  fi
}

apply init.sql
for file in $(ls apps/api/migrations/*.sql | grep -v '\.down\.sql$' | grep -Ev '/0000[01]-' | numeric_sort); do
  apply "$file"
done
for file in $(ls migrations/*.sql | grep -v '\.down\.sql$' | numeric_sort); do
  apply "$file"
done

missing=$(psql "$DATABASE_URL" -At -c "
  SELECT string_agg(t, ', ') FROM unnest(ARRAY[
    'users', 'brands', 'challenges', 'challenge_questions', 'game_sessions',
    'challenge_variants', 'challenge_tiers', 'app_config'
  ]) AS t
  WHERE to_regclass('public.' || t) IS NULL")
if [ -n "$missing" ]; then
  echo "error: load-test schema is missing tables: $missing" >&2
  exit 1
fi
echo "Load-test schema ready."
