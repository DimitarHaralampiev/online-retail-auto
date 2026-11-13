#!/usr/bin/env bash
# Runs the Playwright suite inside the official image, so no browser system
# libraries are needed on the host. The app is built and started inside the
# container (see playwright.config.ts). Extra arguments go to `playwright test`.
set -euo pipefail
version=$(node -p 'require("@playwright/test/package.json").version')
exec docker run --rm --ipc=host \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI \
  -v "$PWD":/app -w /app \
  "mcr.microsoft.com/playwright:v${version}-noble" \
  npx playwright test "$@"
