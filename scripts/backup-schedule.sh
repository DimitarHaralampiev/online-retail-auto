#!/usr/bin/env bash
# The backup service (#56, deploy/compose.yaml): a backup every day at
# BACKUP_AT (UTC, HH:MM, default 02:30), each followed by a restore check
# when RESTORE_SERVER_URL is set. Starts with a backup when the newest one is
# more than a day old. Failures are logged and reported like server errors
# (SENTRY_DSN), and the next day's run happens regardless.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
at="${BACKUP_AT:-02:30}"
[[ "$at" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "BACKUP_AT must be HH:MM (UTC)" >&2; exit 1; }
trap 'exit 0' TERM INT

run() {
  if ! "$here/backup.sh"; then
    node --import tsx "$here/report-failure.ts" "Backup failed"
  elif [[ -n "${RESTORE_SERVER_URL:-}" ]] && ! "$here/restore-check.sh"; then
    node --import tsx "$here/report-failure.ts" "Restore check failed"
  fi
}

shopt -s nullglob
dumps=("${BACKUP_DIR:-/backups}"/auto-shop-*.dump)
if (( ${#dumps[@]} == 0 )) ||
   (( $(date +%s) - $(stat -c %Y "${dumps[-1]}") > 86400 )); then
  run
fi
while :; do
  now="$(date -u +%s)"
  next="$(date -u -d "today $at" +%s)"
  (( next > now )) || next="$(date -u -d "tomorrow $at" +%s)"
  printf '{"time":"%s","level":"info","msg":"Next backup","at":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(date -u -d "@$next" +%Y-%m-%dT%H:%M:%SZ)"
  sleep "$(( next - now ))" & wait $!
  run
done
