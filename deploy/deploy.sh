#!/usr/bin/env bash
# Deploys one commit of the shop on this server (#56):
#   deploy/deploy.sh <full commit sha>
# Run it in the environment's checkout (e.g. /srv/auto-shop/production) or
# let the Deploy workflow run it over SSH (deploy/ssh-deploy.sh). It
#   1. checks out the commit (production: only commits on origin/main),
#   2. pulls that commit's images, which CI built and tested,
#   3. backs up the current database,
#   4. applies the migrations while the old version keeps serving, so a
#      migration must stay compatible with the previous release,
#   5. starts the new web, worker and backup containers and waits until the
#      shop passes its health check.
# Any failure stops the deploy there. Until step 5 the previous version keeps
# running and the checkout returns to it; if step 5 fails, deploy the
# previous commit again.
set -euo pipefail

main() {
  local sha="${1:-}"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "Usage: deploy.sh <full 40-character commit sha>"
  cd "$(dirname "$0")/.."
  local file
  for file in deploy/.env deploy/app.env deploy/backup.env; do
    [[ -f "$file" ]] || fail "Missing $file (see deploy/*.example and docs/operations/runbook.md)"
  done
  local environment port images
  environment="$(setting SHOP_ENVIRONMENT)"
  port="$(setting WEB_PORT)"
  images="$(setting SHOP_IMAGES)"
  [[ "$environment" =~ ^(production|staging)$ ]] || fail "SHOP_ENVIRONMENT must be production or staging"
  [[ "${port:=3000}" =~ ^[0-9]+$ ]] || fail "WEB_PORT must be a port number"
  [[ -n "$images" ]] || fail "Set SHOP_IMAGES in deploy/.env"

  step "Checking out $sha"
  git fetch --quiet origin
  previous="$(git rev-parse HEAD)"
  trap 'restore_checkout $?' EXIT
  if [[ "$environment" == production ]]; then
    git merge-base --is-ancestor "$sha" origin/main ||
      fail "Production deploys only commits on main"
  fi
  git checkout --quiet --detach "$sha"

  step "Pulling images"
  export WEB_IMAGE="$images-web:sha-$sha" TASKS_IMAGE="$images-tasks:sha-$sha" SHOP_RELEASE="$sha"
  docker pull --quiet "$WEB_IMAGE"
  docker pull --quiet "$TASKS_IMAGE"

  step "Backing up the database"
  compose up --detach --wait db
  compose run --rm --no-deps backup scripts/backup.sh

  step "Applying migrations"
  compose run --rm --no-deps migrate

  step "Starting the new version"
  started=1
  compose up --detach --remove-orphans web worker backup
  local attempt
  for attempt in $(seq 60); do
    curl -fs -o /dev/null --max-time 5 "http://127.0.0.1:$port/api/health" && break
    (( attempt < 60 )) || { compose logs --tail 80 web >&2; fail "The new version is not healthy"; }
    sleep 2
  done
  printf 'WEB_IMAGE=%s\nTASKS_IMAGE=%s\nSHOP_RELEASE=%s\n' "$WEB_IMAGE" "$TASKS_IMAGE" "$sha" \
    > deploy/release.env
  # Shop images (labelled in the Dockerfile) unused for 30 days.
  docker image prune --all --force --filter "label=auto-shop.image" \
    --filter "until=720h" > /dev/null
  printf '{"time":"%s","level":"info","msg":"Deployed","environment":"%s","release":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$environment" "$sha"
}

previous=""
started=0
restore_checkout() {
  if (( $1 != 0 && started == 0 )) && [[ -n "$previous" ]]; then
    git checkout --quiet --detach "$previous" &&
      echo "The previous version keeps running; checkout is back at $previous" >&2
  fi
}
fail() { echo "Deploy failed: $1" >&2; exit 1; }
step() { printf '\n== %s\n' "$1"; }
setting() { sed -n "s/^$1=//p" deploy/.env | tail -1; }
compose() { docker compose --env-file deploy/.env -f deploy/compose.yaml "$@"; }

# The checkout replaces this file; bash has read all of main() already.
main "$@"
exit
