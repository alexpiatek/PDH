#!/usr/bin/env bash
set -euo pipefail
umask 077
export CI=true
sha=1fd72b07baf6cd3864ee0ef34b40923a8f5621e5
root=/home/pdh/PDH
cd "$root"
test "$(pwd -P)" = "$root"
exec 9>"$(git rev-parse --git-common-dir)/pdh-deploy.lock"
flock -n 9 || { echo 'Another deployment is active'; exit 1; }
git fetch origin main
test "$(git rev-parse origin/main)" = "$sha" || { echo 'Main changed; release requires review'; exit 1; }
test "$(git rev-parse HEAD)" = 978b94ef244898fab9e80264857b760561d98f87 || { echo 'Server revision changed; release requires review'; exit 1; }
test -w apps/web
test -w apps/web/.next
# The server's unfinished campaign source remains in its working copy.
# Runtime dependencies, shared game code, and public assets must be unchanged.
test -z "$(git status --porcelain -- packages apps/nakama package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .pnpmfile.cjs apps/web/package.json apps/web/next.config.js apps/web/next.config.mjs apps/web/public)"
release="/home/pdh/.pdh-releases/${sha}-web-$(date +%s)"
git worktree add --detach "$release" "$sha"
for path in .env apps/web/.env.local; do
  test ! -f "$path" || cp -p "$path" "$release/$path"
done
while IFS= read -r -d '' path; do
  case "$path" in
    */package.json|package.json|pnpm-lock.yaml|pnpm-workspace.yaml|.npmrc|.pnpmfile.cjs|patches/*|packages/*|apps/web/next.config.*)
      cmp -s "$root/$path" "$release/$path" || { echo 'Runtime dependency or shared-code mismatch; release stopped'; exit 1; }
      ;;
  esac
done < <(git ls-tree -r --name-only -z "$sha")
(
  cd "$release"
  bash scripts/run-pnpm.sh install --frozen-lockfile --prod=false
  bash scripts/run-pnpm.sh -C packages/engine build
  bash scripts/run-pnpm.sh -C apps/nakama build
  bash scripts/run-pnpm.sh -C apps/web build
)
test "$(git rev-parse HEAD)" = 978b94ef244898fab9e80264857b760561d98f87
test "$(git rev-parse origin/main)" = "$sha"
test -z "$(git status --porcelain -- apps/web/public package.json pnpm-lock.yaml apps/web/package.json apps/web/next.config.js apps/web/next.config.mjs)"
assets=(apps/web/public/brand/coastal-hero.jpg apps/web/public/brand/bondi-poker-header-art.png)
for asset in "${assets[@]}"; do
  test -f "$release/$asset"
  if test -e "$asset"; then
    cmp -s "$asset" "$release/$asset" || { echo 'A live public asset changed; release stopped'; exit 1; }
  fi
done
backup="$release/previous-web-build"
cp -a apps/web/.next "$backup"
incoming="$root/apps/web/.next-publish-$(date +%s)"
test ! -e "$incoming"
cp -a "$release/apps/web/.next" "$incoming"
wait_health() {
  for _ in $(seq 1 20); do
    if curl --connect-timeout 2 --max-time 5 -fsS "$1" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}
rollback() {
  trap - ERR TERM INT
  echo 'Activation failed; restoring the previous web build.'
  if test -d apps/web/.next; then mv apps/web/.next "$release/failed-web-build"; fi
  cp -a "$backup" apps/web/.next
  sudo -n /bin/systemctl restart pdh-web
  sudo -n /bin/systemctl is-active --quiet pdh-web
}
trap 'status=$?; rollback; exit "$status"' ERR
trap 'rollback; exit 1' TERM INT
mv apps/web/.next "$release/replaced-web-build"
mv "$incoming" apps/web/.next
for asset in "${assets[@]}"; do cp -p "$release/$asset" "$asset"; done
sudo -n /bin/systemctl restart pdh-web
sudo -n /bin/systemctl is-active --quiet pdh-web
wait_health https://bondipoker.online/
wait_health https://bondipoker.online/play
wait_health https://api.bondipoker.online/healthcheck
printf '%s\n' "$sha" > "$(git rev-parse --git-common-dir)/pdh-active-web-release"
trap - ERR TERM INT
echo "Published tested web release $sha. Server campaign work and game services retained."
