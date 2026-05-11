#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"
NAKAMA_HEALTH_URL="${NAKAMA_HEALTH_URL:-http://127.0.0.1:7350/healthcheck}"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE"
[[ -f "$COMPOSE_FILE" ]] || die "Missing $COMPOSE_FILE"

echo "Installing dependencies..."
(
  cd "$ROOT_DIR"
  if git ls-files --error-unmatch pnpm-lock.yaml >/dev/null 2>&1; then
    ./scripts/run-pnpm.sh install --frozen-lockfile --prod=false
  else
    ./scripts/run-pnpm.sh install --no-frozen-lockfile --prod=false
  fi
)

echo "Building engine and Nakama runtime..."
(
  cd "$ROOT_DIR"
  ./scripts/run-pnpm.sh -C packages/engine build
  ./scripts/run-pnpm.sh -C apps/nakama build
  [[ -f apps/nakama/dist/pdh.js ]] || die "apps/nakama/dist/pdh.js was not produced."
)

echo "Updating production Nakama stack..."
(
  cd "$ROOT_DIR"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm nakama-migrate
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate nakama
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
)

echo "Checking Nakama health..."
curl -fsS "$NAKAMA_HEALTH_URL" >/dev/null

echo "Deploying web service..."
"$ROOT_DIR/scripts/deploy-web-prod.sh"

echo "Full production deploy complete."
