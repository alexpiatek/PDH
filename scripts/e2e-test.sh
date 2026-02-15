#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.test.yml"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pdh_e2e_${$}}"
PORT_OFFSET=$(( $$ % 1000 ))

is_port_in_use() {
  local candidate="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH | awk '{print $4}' | grep -Eq ":${candidate}$"
    return
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq ":${candidate}$"
    return
  fi
  return 1
}

find_free_port() {
  local candidate="$1"
  while is_port_in_use "$candidate"; do
    candidate=$((candidate + 1))
  done
  echo "$candidate"
}

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

HTTP_PORT="$(find_free_port "${E2E_NAKAMA_HTTP_PORT:-$((18350 + PORT_OFFSET))}")"
CONSOLE_PORT="$(find_free_port "${E2E_NAKAMA_CONSOLE_PORT:-$((18351 + PORT_OFFSET))}")"
POSTGRES_PORT="$(find_free_port "${E2E_POSTGRES_PORT:-$((16432 + PORT_OFFSET))}")"
WEB_PORT="$(find_free_port "${E2E_WEB_PORT:-$((3001 + PORT_OFFSET))}")"

export NAKAMA_HTTP_PORT="$HTTP_PORT"
export NAKAMA_CONSOLE_PORT="$CONSOLE_PORT"
export POSTGRES_PORT="$POSTGRES_PORT"

export NAKAMA_SOCKET_SERVER_KEY="${E2E_NAKAMA_SERVER_KEY:-e2e_socket_server_key_local_1234567890}"

export E2E_NAKAMA_HTTP_PORT="$HTTP_PORT"
export E2E_NAKAMA_SERVER_KEY="$NAKAMA_SOCKET_SERVER_KEY"
export E2E_WEB_PORT="$WEB_PORT"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:${WEB_PORT}}"
export E2E_NAKAMA_MATCH_MODULE="${E2E_NAKAMA_MATCH_MODULE:-pdh}"
export E2E_NAKAMA_TABLE_ID="${E2E_NAKAMA_TABLE_ID:-main}"

export NEXT_PUBLIC_NETWORK_BACKEND="nakama"
export NEXT_PUBLIC_NAKAMA_HOST="127.0.0.1"
export NEXT_PUBLIC_NAKAMA_PORT="$HTTP_PORT"
export NEXT_PUBLIC_NAKAMA_USE_SSL="false"
export NEXT_PUBLIC_NAKAMA_SERVER_KEY="$NAKAMA_SOCKET_SERVER_KEY"
export NEXT_PUBLIC_NAKAMA_MATCH_MODULE="$E2E_NAKAMA_MATCH_MODULE"
export NEXT_PUBLIC_NAKAMA_TABLE_ID="$E2E_NAKAMA_TABLE_ID"

echo "E2E ports: web=${E2E_WEB_PORT} nakama-http=${HTTP_PORT} nakama-console=${CONSOLE_PORT} postgres=${POSTGRES_PORT}"

EXISTING_WEB_PROCESSES="$(
  ps -ef | grep -F "$ROOT_DIR/apps/web" | grep -F 'next/dist/bin/next' | grep -v grep || true
)"
if [[ -n "$EXISTING_WEB_PROCESSES" ]]; then
  echo "E2E tests require apps/web Next.js to be stopped before running." >&2
  echo "$EXISTING_WEB_PROCESSES" >&2
  exit 1
fi

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

HEALTH_URL="http://127.0.0.1:${HTTP_PORT}/healthcheck"
for _ in $(seq 1 60); do
  if curl --connect-timeout 2 --max-time 5 -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl --connect-timeout 2 --max-time 5 -fsS "$HEALTH_URL" >/dev/null; then
  echo "E2E tests failed: Nakama healthcheck is not ready at ${HEALTH_URL}" >&2
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 nakama postgres >&2
  exit 1
fi

if ! (
  cd "$ROOT_DIR"
  ./scripts/run-pnpm.sh exec playwright test "$@"
); then
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 nakama postgres >&2 || true
  exit 1
fi
