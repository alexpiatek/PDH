#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.dev.yml"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pdh}"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

echo "Building Nakama runtime module..."
(
  cd "$ROOT_DIR"
  ./scripts/run-pnpm.sh -C apps/nakama build
)

echo "Starting Postgres..."
docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres

echo "Running app SQL migrations..."
COMPOSE_FILE="$COMPOSE_FILE" COMPOSE_PROJECT_NAME="$PROJECT_NAME" ENV_FILE="$ENV_FILE" \
  "$ROOT_DIR/scripts/db-migrate.sh"

echo "Applying deterministic seed data..."
COMPOSE_FILE="$COMPOSE_FILE" COMPOSE_PROJECT_NAME="$PROJECT_NAME" ENV_FILE="$ENV_FILE" \
  "$ROOT_DIR/scripts/db-seed.sh"

echo "Running Nakama migrations..."
docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm nakama-migrate

echo "Starting Nakama..."
docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d nakama

HEALTH_SCHEME="http"
HEALTH_HOST="127.0.0.1"
HEALTH_PORT="${NAKAMA_HTTP_PORT:-7350}"
HEALTH_URL="${HEALTH_SCHEME}://${HEALTH_HOST}:${HEALTH_PORT}/healthcheck"

printf "Waiting for Nakama healthcheck (%s)" "$HEALTH_URL"
for _ in $(seq 1 60); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo
    echo "Nakama is healthy."
    docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
    exit 0
  fi
  printf "."
  sleep 2
done

echo

echo "Nakama healthcheck failed after timeout. Recent logs:" >&2
docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=120 nakama >&2
exit 1
