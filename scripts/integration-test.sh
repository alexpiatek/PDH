#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.dev.yml"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pdh_itest}"

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

cleanup() {
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down --remove-orphans --volumes >/dev/null 2>&1 || true
}
trap cleanup EXIT

(
  cd "$ROOT_DIR"
  ./scripts/run-pnpm.sh -C apps/nakama build
)

docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres
docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm nakama-migrate
docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d nakama

BASE_URL="http://127.0.0.1:${HTTP_PORT}"
HEALTH_URL="${BASE_URL}/healthcheck"

for _ in $(seq 1 60); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -fsS "$HEALTH_URL" >/dev/null; then
  echo "Integration test failed: Nakama healthcheck is not ready." >&2
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=120 nakama >&2
  exit 1
fi

auth_response=$(curl -fsS -u "${NAKAMA_SOCKET_SERVER_KEY}:" -H 'Content-Type: application/json' \
  -d "{\"id\":\"integration-device-$(date +%s)\",\"username\":\"integration-user\"}" \
  "${BASE_URL}/v2/account/authenticate/device?create=true")

token=$(printf '%s' "$auth_response" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["token"])')
account_response=$(curl -fsS -H "Authorization: Bearer ${token}" "${BASE_URL}/v2/account")
account_id=$(printf '%s' "$account_response" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["user"]["id"])')
if [[ -z "$account_id" ]]; then
  echo "Integration test failed: authenticated account id missing." >&2
  exit 1
fi

echo "Integration test passed (healthcheck + auth + authenticated account endpoint)."
