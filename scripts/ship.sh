#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MESSAGE="${1:-}"

usage() {
  cat <<'EOF'
Usage:
  pnpm ship "commit message"

Behavior:
  1) stages current repo changes
  2) creates a git commit
  3) pushes the current branch
  4) SSHes to production, pulls the new code, and runs the deploy script

Optional env:
  DEPLOY_SCRIPT=./scripts/deploy-prod.sh
  GIT_PUSH_REMOTE=origin
  GIT_PUSH_BRANCH=<current-branch>
EOF
}

if [[ -z "$MESSAGE" || "$MESSAGE" == "-h" || "$MESSAGE" == "--help" || "$MESSAGE" == "help" ]]; then
  usage
  exit 1
fi

cd "$ROOT_DIR"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "HEAD" ]]; then
  echo "Detached HEAD is not supported for pnpm ship." >&2
  exit 1
fi

if ! git diff --check; then
  echo "Refusing to ship while git diff --check reports whitespace/conflict-marker issues." >&2
  exit 1
fi

git add -A

if git diff --cached --quiet; then
  echo "No staged changes to commit." >&2
  exit 1
fi

git commit -m "$MESSAGE"

DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-./scripts/deploy-prod.sh}" pnpm git push:web
