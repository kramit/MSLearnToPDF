#!/usr/bin/env sh
set -eu

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TOOLS_ROOT="$REPO_ROOT/.tools"
cd "$REPO_ROOT"

INSTALL_PREREQUISITES=0
if [ "${1-}" = "--install-prerequisites" ]; then
  INSTALL_PREREQUISITES=1
  shift
fi

activate_local_node() {
  for local_node in "$TOOLS_ROOT"/node-v22.*/bin/node; do
    if [ -x "$local_node" ]; then
      PATH=$(dirname "$local_node"):$PATH
      export PATH
      return
    fi
  done
}

node_22_is_available() {
  command -v node >/dev/null 2>&1 || return 1
  NODE_VERSION=$(node -p "process.versions.node" 2>/dev/null) || return 1
  NODE_MAJOR=${NODE_VERSION%%.*}
  [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null
}

download_file() {
  source_url=$1
  destination=$2
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$source_url" -o "$destination"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$destination" "$source_url"
  else
    echo "curl or wget is required for automatic installation." >&2
    exit 1
  fi
}

install_local_node_22() {
  case $(uname -s) in
    Darwin) node_os=darwin ;;
    Linux) node_os=linux ;;
    *)
      echo "Automatic Node.js installation is not supported on this operating system." >&2
      echo "Install Node.js 22 or newer from https://nodejs.org/." >&2
      exit 1
      ;;
  esac

  case $(uname -m) in
    x86_64|amd64) node_arch=x64 ;;
    arm64|aarch64) node_arch=arm64 ;;
    *)
      echo "Automatic Node.js installation does not support architecture: $(uname -m)" >&2
      echo "Install Node.js 22 or newer from https://nodejs.org/." >&2
      exit 1
      ;;
  esac

  command -v tar >/dev/null 2>&1 || {
    echo "tar is required to unpack Node.js." >&2
    exit 1
  }

  echo "Downloading a repository-local Node.js 22 installation..."
  mkdir -p "$TOOLS_ROOT"
  distribution_url=https://nodejs.org/dist/latest-v22.x
  checksums_path="$TOOLS_ROOT/SHASUMS256.txt"
  download_file "$distribution_url/SHASUMS256.txt" "$checksums_path"
  artifact_name=$(awk -v target="-${node_os}-${node_arch}.tar.gz" '$2 ~ target "$" { print $2; exit }' "$checksums_path")
  expected_hash=$(awk -v artifact="$artifact_name" '$2 == artifact { print $1; exit }' "$checksums_path")
  if [ -z "$artifact_name" ] || [ -z "$expected_hash" ]; then
    echo "Could not find a compatible Node.js 22 download." >&2
    exit 1
  fi

  archive_path="$TOOLS_ROOT/$artifact_name"
  download_file "$distribution_url/$artifact_name" "$archive_path"
  if command -v sha256sum >/dev/null 2>&1; then
    actual_hash=$(sha256sum "$archive_path" | awk '{ print $1 }')
  elif command -v shasum >/dev/null 2>&1; then
    actual_hash=$(shasum -a 256 "$archive_path" | awk '{ print $1 }')
  else
    echo "sha256sum or shasum is required to verify the Node.js download." >&2
    exit 1
  fi
  if [ "$actual_hash" != "$expected_hash" ]; then
    rm -f "$archive_path"
    echo "The downloaded Node.js archive failed checksum verification and was removed." >&2
    exit 1
  fi

  tar -xzf "$archive_path" -C "$TOOLS_ROOT"
  rm -f "$archive_path" "$checksums_path"
  activate_local_node
}

require_node_22() {
  activate_local_node
  if ! node_22_is_available && [ "$INSTALL_PREREQUISITES" -eq 1 ]; then
    install_local_node_22
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 22 or newer is required but was not found." >&2
    echo "Rerun with --install-prerequisites to download it locally," >&2
    echo "or install it from https://nodejs.org/." >&2
    exit 1
  fi

  if ! VERSION=$(node -p "process.versions.node"); then
    echo "Node.js was found but could not be started." >&2
    echo "Reinstall Node.js 22 or newer from https://nodejs.org/." >&2
    exit 1
  fi

  MAJOR=${VERSION%%.*}
  if [ "$MAJOR" -lt 22 ]; then
    echo "Node.js 22 or newer is required. Found $VERSION." >&2
    echo "Rerun with --install-prerequisites to download it locally," >&2
    echo "or update Node.js from https://nodejs.org/." >&2
    exit 1
  fi
}

require_project_files() {
  if [ ! -f "$REPO_ROOT/package.json" ]; then
    echo "package.json was not found in $REPO_ROOT." >&2
    echo "Run this script from a complete copy of the MSLearnToPDF repository." >&2
    exit 1
  fi
}

select_package_manager() {
  if command -v pnpm >/dev/null 2>&1; then
    PACKAGE_MANAGER=pnpm
  elif command -v corepack >/dev/null 2>&1; then
    PACKAGE_MANAGER=corepack
  elif command -v npm >/dev/null 2>&1; then
    PACKAGE_MANAGER=npm
  else
    echo "No supported Node.js package manager was found." >&2
    echo "Install Node.js 22 or newer with npm, or install pnpm, and then reopen this terminal." >&2
    exit 1
  fi
}

run_package_manager() {
  case "$PACKAGE_MANAGER" in
    pnpm) pnpm "$@" ;;
    corepack) corepack pnpm "$@" ;;
    npm) npm "$@" ;;
  esac
}

install_dependencies() {
  if [ -d "$REPO_ROOT/node_modules/ink" ] &&
     [ -d "$REPO_ROOT/node_modules/react" ] &&
     [ -d "$REPO_ROOT/node_modules/playwright" ]; then
    return
  fi

  echo "Installing Node.js dependencies..."
  select_package_manager
  if [ "$PACKAGE_MANAGER" = "npm" ]; then
    run_package_manager install --no-package-lock
  else
    run_package_manager install
  fi
}

install_chromium() {
  if node -e "const fs = require('node:fs'); const { chromium } = require('playwright'); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1)" >/dev/null 2>&1; then
    return
  fi
  echo "Installing Playwright Chromium for PDF generation..."
  select_package_manager
  if [ "$PACKAGE_MANAGER" = "npm" ]; then
    run_package_manager exec -- playwright install chromium
  else
    run_package_manager exec playwright install chromium
  fi
}

require_node_22
require_project_files
install_dependencies
install_chromium

if [ "${1-}" = "--config" ] && [ "${2-}" != "" ]; then
  exec node src/tui.js --config "$2"
fi

exec node src/tui.js "$@"
