#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

(
  cd "$ROOT_DIR"
  # Keep this aligned with the repo's current compile contract.
  # Full strict TS checks are not yet enabled across all packages.
  ./scripts/run-pnpm.sh -C packages/engine build
  ./scripts/run-pnpm.sh -C apps/nakama build
  ./scripts/run-pnpm.sh exec tsc -p apps/web/tsconfig.json --noEmit
)
