#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
WEB_ENV_FILE="${WEB_ENV_FILE:-$ROOT_DIR/apps/web/.env.local}"
WEB_SERVICE="${PDH_WEB_SERVICE:-pdh-web}"
EXPECTED_NAKAMA_HOST="${EXPECTED_NAKAMA_HOST:-api.bondipoker.online}"
EXPECTED_NAKAMA_PORT="${EXPECTED_NAKAMA_PORT:-443}"
EXPECTED_NAKAMA_USE_SSL="${EXPECTED_NAKAMA_USE_SSL:-true}"
PLAY_URL="${PLAY_URL:-https://play.bondipoker.online}"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

read_env_value() {
  local file="$1"
  local key="$2"
  local line
  line="$(grep -E "^${key}=" "$file" | tail -n1 || true)"
  [[ -n "$line" ]] || return 1
  printf '%s' "${line#*=}"
}

looks_like_placeholder() {
  local lower
  lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower" == "defaultkey" || "$lower" == *"change_me"* || "$lower" == *"changeme"* ]]
}

ensure_service_workdir_matches_repo() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "WARN: systemctl not found; skipping WorkingDirectory check."
    return
  fi

  local service_workdir
  service_workdir="$(systemctl show -p WorkingDirectory --value "$WEB_SERVICE" 2>/dev/null || true)"
  if [[ -z "$service_workdir" ]]; then
    echo "WARN: Could not read WorkingDirectory for service $WEB_SERVICE; skipping path guard."
    return
  fi

  if [[ "$service_workdir" != "$ROOT_DIR" ]]; then
    die "Service $WEB_SERVICE uses $service_workdir, but this repo is $ROOT_DIR. Run this script from the active service checkout."
  fi
}

verify_live_bundle_key() {
  local expected_key="$1"
  local chunk_path
  local live_js

  chunk_path="$(curl -fsS "$PLAY_URL" | grep -oE '/_next/static/chunks/pages/(play|index)-[^"]+\.js' | head -n1 || true)"
  if [[ -z "$chunk_path" ]]; then
    echo "WARN: Could not discover live game chunk from $PLAY_URL."
    return
  fi

  live_js="$(curl -fsS "${PLAY_URL%/}${chunk_path}" || true)"
  if [[ -z "$live_js" ]]; then
    echo "WARN: Could not fetch live chunk ${PLAY_URL%/}${chunk_path}."
    return
  fi

  if ! grep -q "$expected_key" <<<"$live_js"; then
    die "Live bundle at $PLAY_URL does not contain expected key prefix ${expected_key:0:8}..."
  fi

  echo "Live bundle check passed (${expected_key:0:8}...)."
}

main() {
  [[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE"
  [[ -f "$WEB_ENV_FILE" ]] || die "Missing $WEB_ENV_FILE"

  ensure_service_workdir_matches_repo

  local backend_key frontend_key frontend_host frontend_port frontend_ssl
  backend_key="$(read_env_value "$ENV_FILE" "NAKAMA_SOCKET_SERVER_KEY" || true)"
  frontend_key="$(read_env_value "$WEB_ENV_FILE" "NEXT_PUBLIC_NAKAMA_SERVER_KEY" || true)"
  frontend_host="$(read_env_value "$WEB_ENV_FILE" "NEXT_PUBLIC_NAKAMA_HOST" || true)"
  frontend_port="$(read_env_value "$WEB_ENV_FILE" "NEXT_PUBLIC_NAKAMA_PORT" || true)"
  frontend_ssl="$(read_env_value "$WEB_ENV_FILE" "NEXT_PUBLIC_NAKAMA_USE_SSL" || true)"

  [[ -n "$backend_key" ]] || die "NAKAMA_SOCKET_SERVER_KEY missing in $ENV_FILE"
  [[ -n "$frontend_key" ]] || die "NEXT_PUBLIC_NAKAMA_SERVER_KEY missing in $WEB_ENV_FILE"
  [[ -n "$frontend_host" ]] || die "NEXT_PUBLIC_NAKAMA_HOST missing in $WEB_ENV_FILE"
  [[ -n "$frontend_port" ]] || die "NEXT_PUBLIC_NAKAMA_PORT missing in $WEB_ENV_FILE"
  [[ -n "$frontend_ssl" ]] || die "NEXT_PUBLIC_NAKAMA_USE_SSL missing in $WEB_ENV_FILE"

  if looks_like_placeholder "$backend_key" || looks_like_placeholder "$frontend_key"; then
    die "Socket server key looks like a placeholder in .env or apps/web/.env.local."
  fi

  [[ "$frontend_key" == "$backend_key" ]] || die "Key mismatch: NEXT_PUBLIC_NAKAMA_SERVER_KEY != NAKAMA_SOCKET_SERVER_KEY."
  [[ "$frontend_host" == "$EXPECTED_NAKAMA_HOST" ]] || die "Bad NEXT_PUBLIC_NAKAMA_HOST=$frontend_host (expected $EXPECTED_NAKAMA_HOST)."
  [[ "$frontend_port" == "$EXPECTED_NAKAMA_PORT" ]] || die "Bad NEXT_PUBLIC_NAKAMA_PORT=$frontend_port (expected $EXPECTED_NAKAMA_PORT)."
  [[ "$frontend_ssl" == "$EXPECTED_NAKAMA_USE_SSL" ]] || die "Bad NEXT_PUBLIC_NAKAMA_USE_SSL=$frontend_ssl (expected $EXPECTED_NAKAMA_USE_SSL)."

  echo "Preflight passed. Building apps/web..."
  rm -rf "$ROOT_DIR/apps/web/.next"
  (
    cd "$ROOT_DIR"
    ./scripts/run-pnpm.sh -C apps/web build
  )

  if command -v systemctl >/dev/null 2>&1; then
    echo "Restarting $WEB_SERVICE..."
    systemctl restart "$WEB_SERVICE"
    systemctl is-active --quiet "$WEB_SERVICE" || die "$WEB_SERVICE is not active after restart."
  else
    echo "WARN: systemctl not found; skipped service restart."
  fi

  local local_chunk
  local_chunk="$(ls -1 "$ROOT_DIR/apps/web/.next/static/chunks/pages"/play-*.js 2>/dev/null | head -n1 || true)"
  [[ -n "$local_chunk" ]] || die "Could not find local built play chunk."
  grep -q "$backend_key" "$local_chunk" || die "Local build chunk does not contain expected key prefix ${backend_key:0:8}..."
  grep -q "Startup sanity check failed" "$local_chunk" || die "Local build is missing startup sanity-check logic."
  echo "Local startup sanity-check marker present."

  verify_live_bundle_key "$backend_key"

  echo "Deploy complete."
  echo "Quick verify:"
  echo "CHUNK=\$(curl -sS ${PLAY_URL} | grep -oE '/_next/static/chunks/pages/(play|index)-[^\"]+\\.js' | head -n1)"
  echo "JS=\$(curl -sS \"${PLAY_URL}\$CHUNK\")"
  echo "echo \"\$JS\" | grep -oE '${backend_key:0:8}[0-9a-f]*|37ba066c[0-9a-f]*' | sort -u"
  echo "echo \"\$JS\" | grep -q 'Startup sanity check failed' && echo 'STARTUP_SANITY_CODE=present'"
}

main "$@"
