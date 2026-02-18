#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-web}"
TARGET="${2:-serv}"

usage() {
  cat <<'EOF'
Usage:
  pnpm restart web serv

Behavior:
  Runs the remote web deploy flow (same as `pnpm run deploy:remote:web`).
EOF
}

if [[ "$ACTION" == "web" && "$TARGET" == "serv" ]]; then
  exec "$ROOT_DIR/scripts/deploy-remote-web-prod.sh"
fi

echo "Unknown restart target: $ACTION $TARGET" >&2
usage >&2
exit 1
