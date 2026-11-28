#!/usr/bin/env bash
# Logical backup of the shop database (#56). Run from the tasks image:
#   DATABASE_URL=… BACKUP_DIR=/backups scripts/backup.sh
# Writes into BACKUP_DIR (default /backups):
#   auto-shop-<UTC time>.dump    pg_dump custom format, compressed
#   auto-shop-<UTC time>.counts  rows per table, read in the dump's snapshot
#   auto-shop-<UTC time>.sha256  checksum of the dump
# A dump is kept only when pg_restore can read it. The newest BACKUP_KEEP
# dumps (default 14) stay; older ones are deleted. With BACKUP_REMOTE, an
# rclone path on a crypt remote (the files hold customer data), every backup
# is also copied off the server and remote copies older than
# BACKUP_REMOTE_KEEP_DAYS (default 30) are deleted. docs/operations/backups.md
# DATABASE_URL must be a direct connection, not a transaction pooler: the
# dump reads a snapshot exported by another session.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${DATABASE_URL:?Set DATABASE_URL}"
dir="${BACKUP_DIR:-/backups}"
keep="${BACKUP_KEEP:-14}"
remote="${BACKUP_REMOTE:-}"
remote_days="${BACKUP_REMOTE_KEEP_DAYS:-30}"
fail() { echo "$1" >&2; exit 1; }
[[ "$keep" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_KEEP must be a positive whole number"
[[ "$remote_days" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_REMOTE_KEEP_DAYS must be a positive whole number"
if [[ -n "$remote" ]]; then
  [[ "$remote" == *:* ]] || fail "BACKUP_REMOTE must look like <remote>:<path>"
  type="$(rclone listremotes --long | awk -v name="${remote%%:*}:" '$1 == name { print $2 }')"
  [[ "$type" == crypt ]] ||
    fail "BACKUP_REMOTE must be an rclone crypt remote (found: ${type:-no such remote})"
fi

mkdir -p "$dir"
rm -f -- "$dir"/*.partial
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="auto-shop-$stamp"
base="$dir/$name"
trap 'rm -f -- "$base.dump.partial" "$base.counts.partial"' EXIT

# One read-only transaction exports its snapshot; the row counts and the dump
# both read it, so they describe exactly the same data even while the shop
# keeps taking orders.
coproc PSQL { psql "$DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align -v ON_ERROR_STOP=1; }
send() { printf '%s\n' "$@" >&"${PSQL[1]}"; }
send "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;" "SELECT pg_export_snapshot();"
read -r -t 60 snapshot <&"${PSQL[0]}" || fail "Could not open the backup snapshot"
[[ "$snapshot" =~ ^[0-9A-Fa-f-]+$ ]] || fail "Unexpected snapshot id: $snapshot"
send "\\i $here/backup-counts.sql" "SELECT '--end--';"
: > "$base.counts.partial"
while :; do
  read -r -t 900 line <&"${PSQL[0]}" || fail "Counting rows failed"
  [[ "$line" == --end-- ]] && break
  printf '%s\n' "$line" >> "$base.counts.partial"
done
pg_dump --snapshot="$snapshot" --format=custom --compress=6 --no-owner \
  --no-privileges --file="$base.dump.partial" "$DATABASE_URL"
send "COMMIT;" "\\q"
wait "$PSQL_PID"

pg_restore --list "$base.dump.partial" > /dev/null
mv -- "$base.counts.partial" "$base.counts"
mv -- "$base.dump.partial" "$base.dump"
(cd "$dir" && sha256sum "$name.dump" > "$name.sha256")

shopt -s nullglob
dumps=("$dir"/auto-shop-*.dump)
for (( i = 0; i < ${#dumps[@]} - keep; i++ )); do
  rm -f -- "${dumps[i]}" "${dumps[i]%.dump}.counts" "${dumps[i]%.dump}.sha256"
done

if [[ -n "$remote" ]]; then
  target="$remote"; [[ "$target" == *: || "$target" == */ ]] || target="$target/"
  for ext in dump counts sha256; do
    rclone copyto --retries 5 "$base.$ext" "$target$name.$ext"
  done
  rclone delete --min-age "${remote_days}d" --include "auto-shop-*" "$remote"
fi

printf '{"time":"%s","level":"info","msg":"Backup written","file":"%s","bytes":%s,"tables":%s,"offsite":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name.dump" "$(stat -c %s "$base.dump")" \
  "$(wc -l < "$base.counts")" "$([[ -n "$remote" ]] && echo true || echo false)"
