#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -gt 0 ]]; then
  exec "$ROOT_DIR/scripts/smoke.sh" "$@"
fi

REMOTE_HOST="${REMOTE_HOST:-${SMOKE_HOST:-}}"
REMOTE_PORT="${REMOTE_PORT:-${SMOKE_PORT:-7350}}"
REMOTE_SSL="${REMOTE_SSL:-${SMOKE_USE_SSL:-true}}"

if [[ -z "$REMOTE_HOST" ]]; then
  echo "Usage: $0 --url https://host[:port] [--clients N]"
  echo "   or: REMOTE_HOST=<host> REMOTE_PORT=443 REMOTE_SSL=true $0"
  exit 1
fi

exec "$ROOT_DIR/scripts/smoke.sh" --host "$REMOTE_HOST" --port "$REMOTE_PORT" --ssl "$REMOTE_SSL"
