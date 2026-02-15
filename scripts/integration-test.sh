#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.test.yml"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pdh_itest_${$}}"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

HTTP_PORT="${INTEGRATION_NAKAMA_HTTP_PORT:-17350}"
CONSOLE_PORT="${INTEGRATION_NAKAMA_CONSOLE_PORT:-17351}"
POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT:-15432}"

export NAKAMA_HTTP_PORT="$HTTP_PORT"
export NAKAMA_CONSOLE_PORT="$CONSOLE_PORT"
export POSTGRES_PORT="$POSTGRES_PORT"

export ITEST_NAKAMA_HOST="${INTEGRATION_NAKAMA_HOST:-127.0.0.1}"
export ITEST_NAKAMA_PORT="$HTTP_PORT"
export ITEST_NAKAMA_USE_SSL="${INTEGRATION_NAKAMA_USE_SSL:-false}"
export ITEST_NAKAMA_SERVER_KEY="${NAKAMA_SOCKET_SERVER_KEY:-dev_socket_server_key_change_me}"
export ITEST_NAKAMA_MATCH_MODULE="${INTEGRATION_NAKAMA_MATCH_MODULE:-pdh}"
export ITEST_NAKAMA_MATCH_RPC_ID="${INTEGRATION_NAKAMA_MATCH_RPC_ID:-pdh_ensure_match}"
export ITEST_TIMEOUT_MS="${INTEGRATION_TIMEOUT_MS:-30000}"

cleanup() {
  docker compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    down --remove-orphans --volumes >/dev/null 2>&1 || true
}
trap cleanup EXIT

(
  cd "$ROOT_DIR"
  ./scripts/run-pnpm.sh -C apps/nakama build
)

docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres
docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm nakama-migrate
docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d nakama

BASE_URL="http://${ITEST_NAKAMA_HOST}:${HTTP_PORT}"
HEALTH_URL="${BASE_URL}/healthcheck"

for _ in $(seq 1 60); do
  if curl --connect-timeout 2 --max-time 5 -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl --connect-timeout 2 --max-time 5 -fsS "$HEALTH_URL" >/dev/null; then
  echo "Integration tests failed: Nakama healthcheck is not ready at ${HEALTH_URL}" >&2
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=160 nakama >&2
  exit 1
fi

if ! (
  cd "$ROOT_DIR"
  ./scripts/run-pnpm.sh -C tools/integration test
); then
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 nakama postgres >&2 || true
  exit 1
fi
