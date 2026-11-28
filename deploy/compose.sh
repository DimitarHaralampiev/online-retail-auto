#!/usr/bin/env bash
# docker compose for the deployed version of this environment (#56), e.g.
#   deploy/compose.sh ps
#   deploy/compose.sh logs --tail 100 web
#   deploy/compose.sh run --rm backup scripts/restore-check.sh
# deploy/release.env (written by deploy.sh) names the images in use.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f deploy/release.env ]] || { echo "Nothing deployed yet: run deploy/deploy.sh <commit>" >&2; exit 1; }
exec docker compose --env-file deploy/.env --env-file deploy/release.env -f deploy/compose.yaml "$@"
