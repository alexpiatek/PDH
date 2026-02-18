#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-}"

usage() {
  cat <<'EOF'
Usage:
  pnpm online pull

Required config for pull:
  ONLINE_REMOTE=user@host (environment variable, .env, or positional arg)

Optional env:
  ONLINE_DIR=/root/PDH
  ONLINE_BRANCH=main
  ONLINE_SSH_OPTS="-i ~/.ssh/id_ed25519 -p 22"
EOF
}

case "$ACTION" in
  pull)
    shift
    exec "$ROOT_DIR/scripts/online-remote-pull.sh" "$@"
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    echo "Unknown online action: $ACTION" >&2
    usage >&2
    exit 1
    ;;
esac
