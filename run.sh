#!/usr/bin/env sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$REPO_ROOT"

require_node_22() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 22 or newer is required." >&2
    exit 1
  fi
  VERSION=$(node -p "process.versions.node")
  MAJOR=${VERSION%%.*}
  if [ "$MAJOR" -lt 22 ]; then
    echo "Node.js 22 or newer is required. Found $VERSION" >&2
    exit 1
  fi
}

install_dependencies() {
  if [ -d "$REPO_ROOT/node_modules/ink" ] &&
     [ -d "$REPO_ROOT/node_modules/react" ] &&
     [ -d "$REPO_ROOT/node_modules/playwright" ]; then
    return
  fi
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install
    return
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm install
    return
  fi
  npm install --no-package-lock
}

install_chromium() {
  if node -e "const fs = require('node:fs'); const { chromium } = require('playwright'); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1)" >/dev/null 2>&1; then
    return
  fi
  echo "Installing Playwright Chromium for PDF generation..."
  if command -v pnpm >/dev/null 2>&1; then
    pnpm exec playwright install chromium
    return
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm exec playwright install chromium
    return
  fi
  npx playwright install chromium
}

require_node_22
install_dependencies
install_chromium

if [ "${1-}" = "--config" ] && [ "${2-}" != "" ]; then
  exec node src/tui.js --config "$2"
fi

exec node src/tui.js "$@"
