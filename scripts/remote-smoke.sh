#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

resolve_remote_smoke_key() {
  local ssh_host="${SMOKE_SSH_HOST:-${DEPLOY_REMOTE:-${ONLINE_REMOTE:-}}}"
  local repo_dir="${SMOKE_REMOTE_DIR:-${DEPLOY_DIR:-${ONLINE_DIR:-/home/pdh/PDH}}}"

  if [[ -z "$ssh_host" ]]; then
    return 1
  fi

  ssh "$ssh_host" "cd '$repo_dir' && python3 - <<'PY'
from pathlib import Path
env_file = Path('.env')
if not env_file.exists():
    raise SystemExit(1)
for line in env_file.read_text(errors='ignore').splitlines():
    if line.startswith('NAKAMA_SOCKET_SERVER_KEY='):
        print(line.split('=', 1)[1], end='')
        break
else:
    raise SystemExit(1)
PY"
}

REMOTE_HOST="${REMOTE_HOST:-${PROD_SMOKE_HOST:-${SMOKE_REMOTE_HOST:-}}}"
REMOTE_PORT="${REMOTE_PORT:-${PROD_SMOKE_PORT:-${SMOKE_REMOTE_PORT:-443}}}"
REMOTE_SSL="${REMOTE_SSL:-${PROD_SMOKE_SSL:-${SMOKE_REMOTE_SSL:-true}}}"

if [[ -z "$REMOTE_HOST" ]]; then
  echo "Usage: $0 [--clients N] [--verbose] [--server-key KEY]"
  echo "   or: $0 --url https://host[:port] [--clients N]"
  echo "   or: REMOTE_HOST=<host> REMOTE_PORT=443 REMOTE_SSL=true $0"
  exit 1
fi

if [[ -z "${SMOKE_SERVER_KEY:-}" ]]; then
  if resolved_key="$(resolve_remote_smoke_key 2>/dev/null)"; then
    export SMOKE_SERVER_KEY="$resolved_key"
  fi
fi

exec "$ROOT_DIR/scripts/smoke.sh" --host "$REMOTE_HOST" --port "$REMOTE_PORT" --ssl "$REMOTE_SSL" "$@"
