#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
DEV_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pdh}"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

CHECK_HOST="${CHECK_HOST:-127.0.0.1}"
CHECK_PORT="${CHECK_PORT:-${NAKAMA_HTTP_PORT:-7350}}"
CHECK_SSL="${CHECK_SSL:-false}"

scheme="http"
if [[ "$CHECK_SSL" == "true" ]]; then
  scheme="https"
fi

CHECK_URL="${scheme}://${CHECK_HOST}:${CHECK_PORT}"

echo "== Docker status (dev compose) =="
docker compose --project-name "$DEV_PROJECT_NAME" --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.dev.yml" ps || true
echo

echo "== Docker status (prod compose) =="
docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.prod.yml" ps || true
echo

echo "== Container logs (tail 60) =="
docker compose --project-name "$DEV_PROJECT_NAME" --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.dev.yml" logs --tail=60 nakama postgres || true
echo

echo "== Nakama healthcheck =="
if curl -fsS "${CHECK_URL}/healthcheck" >/dev/null; then
  echo "OK: ${CHECK_URL}/healthcheck"
else
  echo "FAIL: ${CHECK_URL}/healthcheck"
fi
echo

echo "== Curl probe (/v2/healthcheck if available, then /healthcheck) =="
curl -sS -o /dev/null -w 'status=%{http_code}\n' "${CHECK_URL}/v2/healthcheck" || true
curl -sS -o /dev/null -w 'status=%{http_code}\n' "${CHECK_URL}/healthcheck" || true
echo

echo "== Open listening ports (ss/netstat) =="
if command -v ss >/dev/null 2>&1; then
  ss -ltnp | rg -n ":(7350|7351|5432|443|80|${CHECK_PORT})\\b" || true
elif command -v netstat >/dev/null 2>&1; then
  netstat -ltnp 2>/dev/null | rg -n ":(7350|7351|5432|443|80|${CHECK_PORT})\\b" || true
else
  echo "Neither ss nor netstat found"
fi
echo

echo "== UFW status =="
if command -v ufw >/dev/null 2>&1; then
  ufw status verbose || true
else
  echo "ufw not installed"
fi
