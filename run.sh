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
  if [ -d "$REPO_ROOT/node_modules/ink" ]; then
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

require_node_22
install_dependencies

if [ "${1-}" = "--config" ] && [ "${2-}" != "" ]; then
  exec node src/tui.js --config "$2"
fi

exec node src/tui.js "$@"
