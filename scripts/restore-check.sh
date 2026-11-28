#!/usr/bin/env bash
# Proves that a backup restores, and restores one when needed (#56). Run
# from the tasks image (the backup service of deploy/compose.yaml):
#   scripts/restore-check.sh [/backups/auto-shop-<time>.dump]
#   scripts/restore-check.sh /backups/auto-shop-<time>.dump --replace
# Without a file it checks the newest dump in BACKUP_DIR (default /backups).
# RESTORE_SERVER_URL is a server where it may create databases, e.g.
# postgresql://user:pass@host:5432/postgres.
#
# It verifies the checksum, restores into a new database
# restore_check_<time>_<pid>, requires exactly the row counts recorded at
# backup time, applies every migration (today's code must accept the data)
# and drops the copy again. Copies left by a killed run are dropped after a
# day; no other database is changed.
#
# --replace (a real restore; docs/operations/backups.md) keeps the checked
# copy instead: the database in DATABASE_URL, on the same server, is renamed
# to <name>_before_<time> and the copy takes its name. It refuses while
# anything is connected to that database, so stop web, worker and backup
# first. Drop the _before_ database once the shop works again.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail() { echo "$1" >&2; exit 1; }
: "${RESTORE_SERVER_URL:?Set RESTORE_SERVER_URL (a server where the check may create a database)}"
dump="${1:-}"
replace="${2:-}"
[[ -z "$replace" || "$replace" == --replace ]] || fail "Unknown option: $replace"
if [[ -z "$dump" ]]; then
  shopt -s nullglob
  dumps=("${BACKUP_DIR:-/backups}"/auto-shop-*.dump)
  (( ${#dumps[@]} )) || fail "No backups in ${BACKUP_DIR:-/backups}"
  dump="${dumps[-1]}"
fi
[[ -f "$dump" && "$dump" == *.dump ]] || fail "No such backup: $dump"
counts="${dump%.dump}.counts"
checksum="${dump%.dump}.sha256"
[[ -f "$counts" && -f "$checksum" ]] || fail "Missing $counts or $checksum"
(cd "$(dirname "$dump")" && sha256sum --check --quiet "$(basename "$checksum")") ||
  fail "Checksum mismatch: $dump"

sql() { psql "$RESTORE_SERVER_URL" --no-psqlrc --quiet --tuples-only --no-align -v ON_ERROR_STOP=1 "$@"; }
# url <connection url> <part>: host:port, database or the url for database <part>
url() {
  node -e '
    const [href, part] = process.argv.slice(1);
    const u = new URL(href);
    if (part === "server") console.log(`${u.hostname}:${u.port || 5432}`);
    else if (part === "database") console.log(decodeURIComponent(u.pathname.slice(1)));
    else { u.pathname = "/" + part; console.log(u.href); }' "$1" "$2"
}
stamp="$(date -u +%Y%m%d%H%M%S)"
if [[ -n "$replace" ]]; then
  : "${DATABASE_URL:?Set DATABASE_URL (the database to replace)}"
  [[ "$(url "$DATABASE_URL" server)" == "$(url "$RESTORE_SERVER_URL" server)" ]] ||
    fail "DATABASE_URL and RESTORE_SERVER_URL must name the same server"
  live="$(url "$DATABASE_URL" database)"
  [[ "$live" =~ ^[a-z_][a-z0-9_]*$ ]] || fail "Unexpected database name: $live"
fi

cutoff="$(date -u -d '1 day ago' +%Y%m%d%H%M%S)"
while read -r old; do
  if [[ "$old" =~ ^restore_check_([0-9]{14})_[0-9]+$ && "${BASH_REMATCH[1]}" < "$cutoff" ]]; then
    sql -c "DROP DATABASE IF EXISTS \"$old\" WITH (FORCE)"
  fi
done < <(sql -c "SELECT datname FROM pg_database WHERE datname LIKE 'restore\_check\_%'")

name="restore_check_${stamp}_$$"
target="$(url "$RESTORE_SERVER_URL" "$name")"
sql -c "CREATE DATABASE \"$name\""
trap 'sql -c "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)" || true' EXIT

pg_restore --no-owner --no-privileges --exit-on-error --single-transaction \
  --dbname="$target" "$dump"
restored="$(mktemp)"
trap 'rm -f "$restored"; sql -c "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)" || true' EXIT
psql "$target" --no-psqlrc --quiet --tuples-only --no-align -v ON_ERROR_STOP=1 \
  --file "$here/backup-counts.sql" > "$restored"
if ! difference="$(diff "$counts" "$restored")"; then
  echo "Restored rows differ from the backup (< recorded, > restored):" >&2
  echo "$difference" >&2
  exit 1
fi
DATABASE_URL="$target" node "$here/migrate.mjs" > /dev/null

if [[ -z "$replace" ]]; then
  printf '{"time":"%s","level":"info","msg":"Restore check passed","file":"%s","tables":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$dump")" "$(wc -l < "$counts")"
  exit 0
fi

connected="$(sql -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '$live'")"
(( connected == 0 )) ||
  fail "$connected connection(s) to $live: stop web, worker and backup first (docs/operations/backups.md)"
before="${live}_before_${stamp}"
sql -c "ALTER DATABASE \"$live\" RENAME TO \"$before\""
if ! sql -c "ALTER DATABASE \"$name\" RENAME TO \"$live\""; then
  sql -c "ALTER DATABASE \"$before\" RENAME TO \"$live\""
  fail "Could not put the restored copy in place; $live is unchanged"
fi
trap 'rm -f "$restored"' EXIT
printf '{"time":"%s","level":"info","msg":"Database restored","file":"%s","database":"%s","previous":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$dump")" "$live" "$before"
