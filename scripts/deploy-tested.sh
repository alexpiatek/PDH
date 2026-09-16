#!/usr/bin/env bash
# Build a separate release before touching the running service. Never discard work.
set -euo pipefail
umask 077
export CI=true
sha="${1:?A tested commit SHA is required}"
deploy_ref="${PDH_DEPLOY_REF:-origin/main}"
web_service="${PDH_WEB_SERVICE:-pdh-web}"
api_health_url="${PDH_API_HEALTH_URL:-https://api.bondipoker.online/healthcheck}"
web_health_url="${PDH_WEB_HEALTH_URL:-https://bondipoker.online/play}"
[[ "$web_service" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Invalid web service name' >&2; exit 1; }
wait_for_health() {
  local url="$1"
  for _ in $(seq 1 20); do
    if curl --connect-timeout 2 --max-time 5 -fsS "$url" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "Health check failed: $url" >&2
  return 1
}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid SHA' >&2; exit 1; }
root="$(git rev-parse --show-toplevel)"
cd "$root"
exec 9>"$(git rev-parse --git-common-dir)/pdh-deploy.lock"
flock -n 9 || { echo 'Another deployment is active' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Deployment checkout has local changes' >&2; exit 1; }
[[ "$(git rev-parse "$deploy_ref")" == "$sha" ]] || { echo 'Deployment ref changed; skipping stale deployment'; exit 0; }
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
    bash scripts/run-pnpm.sh install --lockfile=false --prod=false || return 1
  fi
  for artifact in apps/web/.next apps/nakama/dist packages/engine/dist; do
    if [[ -d "$backup/$artifact" ]]; then
      [[ ! -e "$artifact" ]] || mv "$artifact" "$release/failed-$(echo "$artifact" | tr / -)"
      cp -a "$backup/$artifact" "$artifact"
    fi
  done
  docker compose --env-file .env -f docker-compose.prod.yml up -d --force-recreate nakama
  sudo -n /bin/systemctl restart "$web_service"
  wait_for_health "$api_health_url"
  # Verify the service locally even if the release's external health URL failed.
  sudo -n /bin/systemctl is-active --quiet "$web_service"
}
trap 'rollback' ERR
trap 'rollback; exit 1' TERM INT
git merge --ff-only "$sha"
bash scripts/run-pnpm.sh install --frozen-lockfile --prod=false
for artifact in apps/web/.next apps/nakama/dist packages/engine/dist; do
  [[ ! -e "$artifact" ]] || mv "$artifact" "$release/replaced-$(echo "$artifact" | tr / -)"
  cp -a "$release/$artifact" "$artifact"
done
docker compose --env-file .env -f docker-compose.prod.yml up -d --force-recreate nakama
sudo -n /bin/systemctl restart "$web_service"
wait_for_health "$api_health_url"
wait_for_health "$web_health_url"
trap - ERR TERM INT
printf 'Activated %s; previous release %s; rollback artifacts %s\n' "$sha" "$previous" "$backup"
