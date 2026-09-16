#!/usr/bin/env bash
# Build a separate release before touching the running service. Never discard work.
set -euo pipefail
umask 077
sha="${1:?A tested commit SHA is required}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid SHA' >&2; exit 1; }
root="$(git rev-parse --show-toplevel)"
cd "$root"
exec 9>"$(git rev-parse --git-common-dir)/pdh-deploy.lock"
flock -n 9 || { echo 'Another deployment is active' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Deployment checkout has local changes' >&2; exit 1; }
[[ "$(git rev-parse origin/main)" == "$sha" ]] || { echo 'A newer main exists; skipping stale deployment'; exit 0; }
git merge-base --is-ancestor HEAD "$sha" || { echo 'Deployment checkout diverged' >&2; exit 1; }
previous="$(git rev-parse HEAD)"
release="$(dirname "$root")/.pdh-releases/${sha}-$(date +%s)"
mkdir -p "$(dirname "$release")"
git worktree add --detach "$release" "$sha"
[[ ! -f .env ]] || cp -p .env "$release/.env"
[[ ! -f apps/web/.env.local ]] || cp -p apps/web/.env.local "$release/apps/web/.env.local"
(
  cd "$release"
  export CI=true
  docker compose --env-file .env -f docker-compose.prod.yml config --quiet
  bash scripts/run-pnpm.sh install --frozen-lockfile --prod=false
  bash scripts/run-pnpm.sh -C packages/engine build
  bash scripts/run-pnpm.sh -C apps/nakama build
  bash scripts/run-pnpm.sh -C apps/web build
)

# Storage collections need no schema migration. Future DB migrations must have
# a separate reviewed backup/restore procedure before this activation step.
backup="$release/previous-artifacts"
mkdir -p "$backup"
for artifact in apps/web/.next apps/nakama/dist packages/engine/dist; do
  mkdir -p "$backup/$(dirname "$artifact")"
  [[ ! -d "$artifact" ]] || cp -a "$artifact" "$backup/$artifact"
done
rollback() {
  echo "Activation failed; restoring $previous. Database contents are retained." >&2
  git switch --detach "$previous" || return 1
  if git cat-file -e "$previous:pnpm-lock.yaml" 2>/dev/null; then
    bash scripts/run-pnpm.sh install --frozen-lockfile --prod=false || return 1
  else
    bash scripts/run-pnpm.sh install --no-frozen-lockfile --prod=false || return 1
  fi
  for artifact in apps/web/.next apps/nakama/dist packages/engine/dist; do
    if [[ -d "$backup/$artifact" ]]; then
      [[ ! -e "$artifact" ]] || mv "$artifact" "$release/failed-$(echo "$artifact" | tr / -)"
      cp -a "$backup/$artifact" "$artifact"
    fi
  done
  docker compose --env-file .env -f docker-compose.prod.yml up -d --force-recreate nakama
  sudo -n /bin/systemctl restart pdh-web
}
trap 'rollback' ERR
sudo -n /bin/systemctl stop pdh-web
git merge --ff-only "$sha"
bash scripts/run-pnpm.sh install --frozen-lockfile --prod=false
for artifact in apps/web/.next apps/nakama/dist packages/engine/dist; do
  [[ ! -e "$artifact" ]] || mv "$artifact" "$release/replaced-$(echo "$artifact" | tr / -)"
  cp -a "$release/$artifact" "$artifact"
done
docker compose --env-file .env -f docker-compose.prod.yml up -d --force-recreate nakama
sudo -n /bin/systemctl restart pdh-web
curl --retry 10 --retry-delay 3 --retry-connrefused -fsS https://api.bondipoker.online/healthcheck >/dev/null
curl --retry 10 --retry-delay 3 --retry-connrefused -fsS https://bondipoker.online/play >/dev/null
trap - ERR
printf 'Activated %s; previous release %s; rollback artifacts %s\n' "$sha" "$previous" "$backup"
