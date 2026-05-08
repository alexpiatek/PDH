#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-}"

usage() {
  cat <<'EOF'
Usage:
  pnpm git push:web

Behavior:
  1) git push <remote> <branch>
  2) pnpm restart web serv

Optional env:
  GIT_PUSH_REMOTE=origin
  GIT_PUSH_BRANCH=<current-branch>
EOF
}

push_web() {
  local push_remote push_branch
  push_remote="${GIT_PUSH_REMOTE:-origin}"
  push_branch="${GIT_PUSH_BRANCH:-$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)}"

  if [[ "$push_branch" == "HEAD" ]]; then
    echo "Detached HEAD is not supported for pnpm git push:web." >&2
    exit 1
  fi

  echo "Pushing $push_branch to $push_remote..."
  (
    cd "$ROOT_DIR"
    git push "$push_remote" "$push_branch"
  )

  echo "Running remote web deploy..."
  (
    cd "$ROOT_DIR"
    pnpm restart web serv
  )
}

case "$ACTION" in
  push:web)
    push_web
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    echo "Unknown git action: $ACTION" >&2
    usage >&2
    exit 1
    ;;
esac
