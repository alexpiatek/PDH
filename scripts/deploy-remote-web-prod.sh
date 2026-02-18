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

DEPLOY_REMOTE="${1:-${DEPLOY_REMOTE:-${ONLINE_REMOTE:-}}}"
DEPLOY_DIR="${2:-${DEPLOY_DIR:-${ONLINE_DIR:-/root/PDH}}}"
DEPLOY_BRANCH="${3:-${DEPLOY_BRANCH:-${ONLINE_BRANCH:-main}}}"
DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-./scripts/deploy-web-prod.sh}"
SSH_BIN="${SSH_BIN:-ssh}"

usage() {
  cat <<'EOF'
Usage:
  DEPLOY_REMOTE=user@host [DEPLOY_DIR=/root/PDH] [DEPLOY_BRANCH=main] ./scripts/deploy-remote-web-prod.sh
  ./scripts/deploy-remote-web-prod.sh user@host [/remote/repo/path] [branch]

Optional environment variables:
  DEPLOY_SCRIPT     Remote deploy script path (default: ./scripts/deploy-web-prod.sh)
  DEPLOY_SSH_OPTS   Extra ssh options as a plain string (example: "-i ~/.ssh/id_ed25519 -p 22")
  ENV_FILE          Config file to source first (default: ./.env)
EOF
}

if [[ -z "$DEPLOY_REMOTE" ]]; then
  usage
  exit 1
fi

SSH_OPTS=()
DEPLOY_SSH_OPTS="${DEPLOY_SSH_OPTS:-${ONLINE_SSH_OPTS:-}}"
if [[ -n "$DEPLOY_SSH_OPTS" ]]; then
  # shellcheck disable=SC2206
  SSH_OPTS=( $DEPLOY_SSH_OPTS )
fi

printf -v ESC_DEPLOY_DIR '%q' "$DEPLOY_DIR"
printf -v ESC_DEPLOY_BRANCH '%q' "$DEPLOY_BRANCH"
printf -v ESC_DEPLOY_SCRIPT '%q' "$DEPLOY_SCRIPT"

echo "Running remote deploy:"
echo "  remote: $DEPLOY_REMOTE"
echo "  dir:    $DEPLOY_DIR"
echo "  branch: $DEPLOY_BRANCH"
echo "  script: $DEPLOY_SCRIPT"

if (( ${#SSH_OPTS[@]} > 0 )); then
  "$SSH_BIN" "${SSH_OPTS[@]}" "$DEPLOY_REMOTE" \
    "DEPLOY_DIR=$ESC_DEPLOY_DIR DEPLOY_BRANCH=$ESC_DEPLOY_BRANCH DEPLOY_SCRIPT=$ESC_DEPLOY_SCRIPT bash -se" <<'EOF'
set -euo pipefail

cd "$DEPLOY_DIR"
git fetch origin
git checkout "$DEPLOY_BRANCH"
git pull --rebase --autostash origin "$DEPLOY_BRANCH"
if ! chmod +x scripts/*.sh 2>/dev/null; then
  echo "WARN: could not chmod scripts/*.sh; continuing."
fi
CI=true "$DEPLOY_SCRIPT"
EOF
else
  "$SSH_BIN" "$DEPLOY_REMOTE" \
    "DEPLOY_DIR=$ESC_DEPLOY_DIR DEPLOY_BRANCH=$ESC_DEPLOY_BRANCH DEPLOY_SCRIPT=$ESC_DEPLOY_SCRIPT bash -se" <<'EOF'
set -euo pipefail

cd "$DEPLOY_DIR"
git fetch origin
git checkout "$DEPLOY_BRANCH"
git pull --rebase --autostash origin "$DEPLOY_BRANCH"
if ! chmod +x scripts/*.sh 2>/dev/null; then
  echo "WARN: could not chmod scripts/*.sh; continuing."
fi
CI=true "$DEPLOY_SCRIPT"
EOF
fi

echo "Remote deploy finished."
