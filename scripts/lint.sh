#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

(
  cd "$ROOT_DIR"
  ./scripts/run-pnpm.sh exec eslint .

  if command -v shellcheck >/dev/null 2>&1; then
    shellcheck scripts/*.sh
  else
    echo "shellcheck not found; skipping shell script lint."
  fi
)
