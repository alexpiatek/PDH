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

ONLINE_REMOTE="${1:-${ONLINE_REMOTE:-${DEPLOY_REMOTE:-}}}"
ONLINE_DIR="${2:-${ONLINE_DIR:-${DEPLOY_DIR:-/root/PDH}}}"
ONLINE_BRANCH="${3:-${ONLINE_BRANCH:-${DEPLOY_BRANCH:-main}}}"
SSH_BIN="${SSH_BIN:-ssh}"
ONLINE_SSH_OPTS="${ONLINE_SSH_OPTS:-${DEPLOY_SSH_OPTS:-}}"

usage() {
  cat <<'EOF'
Usage:
  ONLINE_REMOTE=user@host [ONLINE_DIR=/root/PDH] [ONLINE_BRANCH=main] ./scripts/online-remote-pull.sh
  ./scripts/online-remote-pull.sh user@host [/remote/repo/path] [branch]

Optional environment variables:
  ONLINE_SSH_OPTS  Extra ssh options (example: "-i ~/.ssh/id_ed25519 -p 22")
  ENV_FILE         Config file to source first (default: ./.env)
EOF
}

if [[ -z "$ONLINE_REMOTE" ]]; then
  usage
  exit 1
fi

SSH_OPTS=()
if [[ -n "$ONLINE_SSH_OPTS" ]]; then
  # shellcheck disable=SC2206
  SSH_OPTS=( $ONLINE_SSH_OPTS )
fi

printf -v ESC_ONLINE_DIR '%q' "$ONLINE_DIR"
printf -v ESC_ONLINE_BRANCH '%q' "$ONLINE_BRANCH"

echo "Running remote pull:"
echo "  remote: $ONLINE_REMOTE"
echo "  dir:    $ONLINE_DIR"
echo "  branch: $ONLINE_BRANCH"

if (( ${#SSH_OPTS[@]} > 0 )); then
  "$SSH_BIN" "${SSH_OPTS[@]}" "$ONLINE_REMOTE" \
    "ONLINE_DIR=$ESC_ONLINE_DIR ONLINE_BRANCH=$ESC_ONLINE_BRANCH bash -se" <<'EOF'
set -euo pipefail

cd "$ONLINE_DIR"
git fetch origin
git checkout "$ONLINE_BRANCH"
git pull --rebase origin "$ONLINE_BRANCH"
git rev-parse --short HEAD
EOF
else
  "$SSH_BIN" "$ONLINE_REMOTE" \
    "ONLINE_DIR=$ESC_ONLINE_DIR ONLINE_BRANCH=$ESC_ONLINE_BRANCH bash -se" <<'EOF'
set -euo pipefail

cd "$ONLINE_DIR"
git fetch origin
git checkout "$ONLINE_BRANCH"
git pull --rebase origin "$ONLINE_BRANCH"
git rev-parse --short HEAD
EOF
fi

echo "Remote pull finished."
