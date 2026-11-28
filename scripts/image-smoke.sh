#!/usr/bin/env bash
# Tests the container images together (#56), locally and in CI:
#   scripts/image-smoke.sh [web image] [tasks image]
# On a private Docker network with a throwaway PostgreSQL 17 it migrates
# twice, loads the demo catalog, serves the web image and checks pages,
# assets, headers and probes, runs every worker job once, then takes backups
# while other sessions keep writing and restore-checks them. A tampered dump,
# a damaged dump and wrong row counts must all fail the check. Everything it
# starts is removed at the end; nothing else is touched.
set -euo pipefail
web_image="${1:-auto-shop-web:dev}"
tasks_image="${2:-auto-shop-tasks:dev}"
port="${SMOKE_PORT:-3102}"
id="auto-smoke-$$"
password="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
db_url="postgresql://auto:$password@$id-db:5432/auto"
server_url="postgresql://auto:$password@$id-db:5432/postgres"
base="http://127.0.0.1:$port"

cleanup() {
  docker rm -f "$id-db" "$id-web" > /dev/null 2>&1 || true
  docker volume rm "$id-backups" > /dev/null 2>&1 || true
  docker network rm "$id" > /dev/null 2>&1 || true
}
trap cleanup EXIT
step() { printf '\n== %s\n' "$*"; }
fail() {
  echo "FAILED: $*" >&2
  docker logs --tail 60 "$id-web" 2>&1 | sed 's/^/web | /' >&2 || true
  exit 1
}
# A container from the tasks image on the network, with the backups volume.
task() {
  docker run --rm --network "$id" \
    --mount "type=volume,src=$id-backups,dst=/backups" \
    -e DATABASE_URL="$db_url" -e RESTORE_SERVER_URL="$server_url" \
    "$@"
}
sql() { docker exec "$id-db" psql -U auto -d auto -qAtc "$1"; }

step "PostgreSQL 17"
docker network create "$id" > /dev/null
docker volume create "$id-backups" > /dev/null
docker run -d --name "$id-db" --network "$id" -e POSTGRES_USER=auto \
  -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=auto postgres:17 > /dev/null
for _ in $(seq 60); do
  docker exec "$id-db" pg_isready -h 127.0.0.1 -U auto -d auto > /dev/null 2>&1 && break
  sleep 1
done
docker exec "$id-db" pg_isready -h 127.0.0.1 -U auto -d auto > /dev/null || fail "database did not start"

step "Backup of the empty database (the first deploy takes one)"
task "$tasks_image" scripts/backup.sh > /dev/null
task "$tasks_image" scripts/restore-check.sh

step "Migrations (twice) and demo catalog"
task "$tasks_image" node scripts/migrate.mjs | tail -1
task "$tasks_image" node scripts/migrate.mjs > /dev/null
task -e ALLOW_DEMO_SEED=1 "$tasks_image" node --import tsx scripts/seed-demo-catalog.ts | tail -1

step "Web image"
docker run -d --name "$id-web" --network "$id" -p "127.0.0.1:$port:3000" \
  -e DATABASE_URL="$db_url" -e CATALOG_SOURCE=postgres \
  -e APP_URL="http://localhost:$port" -e ORDERS_MODE=test \
  -e TEST_SHIPPING_CENTS=500 -e COURIER_OFFICES_MODE=demo \
  -e ORDER_TRACKING_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  "$web_image" > /dev/null
for _ in $(seq 60); do
  curl -fs -o /dev/null --max-time 5 "$base/api/health" && break
  sleep 1
done
[[ "$(docker exec "$id-web" id -u)" != 0 ]] || fail "web runs as root"

status() { curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$base$1"; }
for check in "/ 200" "/catalog 200" "/catalog/DEMO-001 200" "/cars 200" \
  "/legal/terms 200" "/robots.txt 200" "/sitemap.xml 200" \
  "/api/health 200" "/api/health?probe=live 200" "/no-such-page 404" \
  "/admin 200" "/api/admin/orders 403"; do
  read -r path want <<< "$check"
  got="$(status "$path")"
  [[ "$got" == "$want" ]] || fail "GET $path answered $got, expected $want"
  echo "GET $path $got"
done
curl -fs --max-time 30 "$base/api/health" | grep -q '"database":"ok"' ||
  fail "health does not report the database"
curl -fs --max-time 30 "$base/catalog" | grep -q 'DEMO-00' ||
  fail "catalog does not list demo products from PostgreSQL"

headers="$(curl -fs -D - -o /dev/null --max-time 30 "$base/")"
for header in "content-security-policy:.*'nonce-" "x-content-type-options: nosniff" \
  "strict-transport-security:" "x-frame-options: DENY" "x-request-id:"; do
  grep -qi "^$header" <<< "$headers" || fail "missing header $header"
done
! grep -qi '^x-powered-by' <<< "$headers" || fail "x-powered-by is sent"
echo "security headers present"

asset="$(curl -fs --max-time 30 "$base/" | grep -o '/_next/static/[^"]*\.js' | head -1)"
[[ -n "$asset" ]] || fail "no script found on the home page"
curl -fs -D - -o /dev/null --max-time 30 "$base$asset" | grep -qi '^cache-control:.*immutable' ||
  fail "static asset $asset missing or not immutable"
image_type="$(curl -fs -o /dev/null -w '%{content_type}' --max-time 60 \
  "$base/_next/image?url=%2Fimages%2Fair-filter.png&w=640&q=75")" ||
  fail "image optimisation failed"
[[ "$image_type" == image/* ]] || fail "optimised image answered $image_type"
echo "static assets and image optimisation work"

step "Worker, every job once"
task "$tasks_image" node --import tsx scripts/worker.ts --once 2>&1 | tail -2

step "Backups while other sessions write"
sql "CREATE TABLE smoke_writes (id serial PRIMARY KEY)"
docker exec -d "$id-db" psql -U auto -d auto -qc \
  "DO \$\$ BEGIN FOR i IN 1..50000 LOOP INSERT INTO smoke_writes DEFAULT VALUES; COMMIT; PERFORM pg_sleep(0.002); END LOOP; END \$\$"
for _ in 1 2 3; do
  task -e BACKUP_KEEP=2 "$tasks_image" scripts/backup.sh
  sleep 1
done
sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE 'DO %smoke_writes%'" > /dev/null
kept="$(task "$tasks_image" sh -c 'ls /backups/*.dump | wc -l')"
[[ "$kept" == 2 ]] || fail "BACKUP_KEEP=2 kept $kept dumps"
# The newest backup was taken while rows were being added.
during="$(task "$tasks_image" sh -c 'grep "^smoke_writes|" "$(ls /backups/*.counts | tail -1)" | cut -d"|" -f2')"
(( during > 0 && during < 50000 )) || fail "backup was not taken during writes ($during rows)"
echo "newest backup holds $during of the rows being written"
task "$tasks_image" scripts/restore-check.sh

step "The restore check must fail on bad backups"
expect_failure() {
  local label="$1" script="$2"
  if task "$tasks_image" bash -c "set -e; d=\$(ls /backups/*.dump | tail -1); c=\${d%.dump}.counts; s=\${d%.dump}.sha256
    cp \$d /tmp/d; cp \$c /tmp/c; cp \$s /tmp/s
    $script
    if scripts/restore-check.sh \$d 2>/tmp/err; then exit 0; fi
    cat /tmp/err >&2; cp /tmp/d \$d; cp /tmp/c \$c; cp /tmp/s \$s; exit 3"; then
    fail "restore check accepted $label"
  elif [[ $? != 3 ]]; then
    fail "could not prepare $label"
  fi
  echo "rejected: $label"
}
expect_failure "a tampered dump" 'printf x | dd of=$d bs=1 seek=4096 conv=notrunc status=none'
expect_failure "a damaged dump with a matching checksum" \
  'truncate -s $(( $(stat -c %s $d) / 2 )) $d; (cd /backups && sha256sum $(basename $d) > $(basename $s))'
expect_failure "wrong row counts" 'sed -i "s/^customers|.*/customers|999/" $c'
task "$tasks_image" scripts/restore-check.sh > /dev/null
[[ "$(sql "SELECT count(*) FROM pg_database WHERE datname LIKE 'restore_check%'")" == 0 ]] ||
  fail "a restore check database was left behind"

step "A real restore (--replace)"
newest="$(task "$tasks_image" sh -c 'ls /backups/*.dump | tail -1')"
sql "INSERT INTO smoke_writes DEFAULT VALUES"
docker stop "$id-web" > /dev/null
# Another session (as a running shop would have) must block the swap.
docker exec -d "$id-db" psql -U auto -d auto -qc "SELECT pg_sleep(60) -- smoke-hold"
for _ in $(seq 20); do
  [[ "$(sql "SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%smoke-hold'")" -gt 1 ]] && break
  sleep 0.5
done
if task "$tasks_image" scripts/restore-check.sh "$newest" --replace 2> /dev/null; then
  fail "a restore replaced the database while another session was connected"
fi
sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE '%smoke-hold' AND pid <> pg_backend_pid()" > /dev/null
[[ "$(sql "SELECT count(*) FROM pg_database WHERE datname LIKE 'auto\_before\_%' OR datname LIKE 'restore\_check\_%'")" == 0 ]] ||
  fail "a refused restore left a database behind"
echo "refused while another session is connected, nothing changed"
task "$tasks_image" scripts/restore-check.sh "$newest" --replace
[[ "$(sql 'SELECT count(*) FROM smoke_writes')" == "$during" ]] ||
  fail "the restored database does not hold the backup's rows"
[[ "$(sql "SELECT count(*) FROM pg_database WHERE datname LIKE 'auto\_before\_%'")" == 1 ]] ||
  fail "the replaced database was not kept"
docker start "$id-web" > /dev/null
for _ in $(seq 60); do
  curl -fs -o /dev/null --max-time 5 "$base/api/health" && break
  sleep 1
done
[[ "$(status /catalog/DEMO-001)" == 200 ]] || fail "the shop does not work on the restored database"
echo "restored the backup, kept the old database, the shop works again"

step "Off-site copy"
if task -e BACKUP_REMOTE=plain:copies -e RCLONE_CONFIG_PLAIN_TYPE=local \
  "$tasks_image" scripts/backup.sh 2> /dev/null; then
  fail "an unencrypted remote was accepted"
fi
echo "rejected: an unencrypted remote"
obscured="$(docker run --rm "$tasks_image" rclone obscure "$password")"
offsite=(-e RCLONE_CONFIG_OFFSITE_TYPE=crypt -e RCLONE_CONFIG_OFFSITE_REMOTE=/backups/offsite
  -e RCLONE_CONFIG_OFFSITE_PASSWORD="$obscured" -e BACKUP_REMOTE=offsite:shop)
task "${offsite[@]}" "$tasks_image" scripts/backup.sh
copies="$(task "${offsite[@]}" "$tasks_image" rclone lsf offsite:shop)"
[[ "$(grep -c '^auto-shop-' <<< "$copies")" == 3 ]] || fail "off-site copy has: $copies"
task "$tasks_image" sh -c '! find /backups/offsite -type f -name "auto-shop-*" | grep -q .' ||
  fail "off-site file names are not encrypted"
echo "off-site copy is encrypted and complete"

step "Daily schedule"
schedule="$(task -e BACKUP_DIR=/backups/schedule "$tasks_image" \
  timeout 30 scripts/backup-schedule.sh 2>&1 || true)"
grep -q '"msg":"Backup written"' <<< "$schedule" && grep -q '"msg":"Restore check passed"' <<< "$schedule" ||
  fail "the schedule did not back up and check at start: $schedule"
echo "first run backs up and restore-checks at once"
broken="$(docker run --rm --network "$id" -e DATABASE_URL="postgresql://auto:wrong@$id-db:5432/auto" \
  -e BACKUP_DIR=/tmp/b "$tasks_image" timeout 10 scripts/backup-schedule.sh 2>&1 || true)"
grep -q '"level":"error","msg":"Backup failed"' <<< "$broken" ||
  fail "a failed backup was not reported: $broken"
echo "a failed backup is reported"

step "Container health check"
for _ in $(seq 45); do
  health="$(docker inspect --format '{{.State.Health.Status}}' "$id-web")"
  [[ "$health" == healthy ]] && break
  sleep 2
done
[[ "$health" == healthy ]] || fail "web container is $health"
echo "web container is healthy"

printf '\nImage smoke test passed.\n'
