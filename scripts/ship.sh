#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MESSAGE="${1:-}"
TARGET_BRANCH="${SHIP_TARGET_BRANCH:-main}"
PUSH_REMOTE="${GIT_PUSH_REMOTE:-origin}"

usage() {
  cat <<'EOF'
Usage:
  pnpm ship ["commit message"]

Behavior:
  1) optionally stages current repo changes and creates a git commit
  2) pushes the current branch
  3) updates local main from origin
  4) merges the current branch into main
  5) pushes main
  6) SSHes to production, pulls main, and runs the deploy script

Optional env:
  DEPLOY_SCRIPT=./scripts/deploy-prod.sh
  GIT_PUSH_REMOTE=origin
  SHIP_TARGET_BRANCH=main
EOF
}

if [[ "$MESSAGE" == "-h" || "$MESSAGE" == "--help" || "$MESSAGE" == "help" ]]; then
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

if [[ "$branch" == "$TARGET_BRANCH" ]]; then
  echo "Shipping from $TARGET_BRANCH directly."
else
  echo "Shipping $branch by merging it into $TARGET_BRANCH."
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  if [[ -z "$MESSAGE" ]]; then
    echo "Commit message required when the working tree has uncommitted changes." >&2
    exit 1
  fi

  git add -A

  if git diff --cached --quiet; then
    echo "No staged changes to commit." >&2
    exit 1
  fi

  git commit -m "$MESSAGE"
fi

git push "$PUSH_REMOTE" "$branch"

if [[ "$branch" != "$TARGET_BRANCH" ]]; then
  git fetch "$PUSH_REMOTE" "$TARGET_BRANCH"
  git checkout "$TARGET_BRANCH"
  git pull --rebase --autostash "$PUSH_REMOTE" "$TARGET_BRANCH"
  git merge --no-ff --no-edit "$branch"
fi

git push "$PUSH_REMOTE" "$TARGET_BRANCH"
DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-./scripts/deploy-prod.sh}" pnpm restart web serv

if [[ "$branch" != "$TARGET_BRANCH" ]]; then
  git checkout "$branch"
fi
