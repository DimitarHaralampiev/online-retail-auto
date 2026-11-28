#!/usr/bin/env bash
# The only command the CI deploy key may run on the server (#56). Copy it to
# /srv/auto-shop/ssh-deploy.sh (outside the checkouts, so no deploy can
# change it; owned by root, not writable by the deploy user) and put the
# key in the deploy user's ~/.ssh/authorized_keys as
#   command="/srv/auto-shop/ssh-deploy.sh",restrict ssh-ed25519 AAAA… ci-deploy
# The Deploy workflow sends "<staging|production> <commit sha>".
set -euo pipefail
base=/srv/auto-shop
read -r environment sha extra <<< "${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "${environment:-}" =~ ^(staging|production)$ || ! "${sha:-}" =~ ^[0-9a-f]{40}$ || -n "${extra:-}" ]]; then
  echo "Expected: <staging|production> <full commit sha>" >&2
  exit 1
fi
exec "$base/$environment/deploy/deploy.sh" "$sha"
