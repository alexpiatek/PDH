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

is_truthy() {
  local lower
  lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower" == "true" || "$lower" == "1" || "$lower" == "yes" || "$lower" == "on" ]]
}

validate_email_alert_config() {
  local enabled
  enabled="$(read_env_value "$WEB_ENV_FILE" "EMAIL_ALERTS_ENABLED" || true)"
  if ! is_truthy "$enabled"; then
    return
  fi

  local key value
  for key in \
    SMTP_HOST \
    SMTP_PORT \
    SMTP_SECURE \
    SMTP_USER \
    SMTP_PASS \
    ALERT_EMAIL_FROM \
    ALERT_EMAIL_TO
  do
    value="$(read_env_value "$WEB_ENV_FILE" "$key" || true)"
    [[ -n "$value" ]] || die "$key missing in $WEB_ENV_FILE while EMAIL_ALERTS_ENABLED is true."
  done

  local smtp_host smtp_port smtp_secure
  smtp_host="$(read_env_value "$WEB_ENV_FILE" "SMTP_HOST")"
  smtp_port="$(read_env_value "$WEB_ENV_FILE" "SMTP_PORT")"
  smtp_secure="$(read_env_value "$WEB_ENV_FILE" "SMTP_SECURE")"

  [[ "$smtp_port" =~ ^[0-9]+$ && "$smtp_port" -ge 1 && "$smtp_port" -le 65535 ]] ||
    die "SMTP_PORT must be a number between 1 and 65535 in $WEB_ENV_FILE."

  is_truthy "$smtp_secure" || [[ "$(printf '%s' "$smtp_secure" | tr '[:upper:]' '[:lower:]')" =~ ^(false|0|no|off)$ ]] ||
    die "SMTP_SECURE must be a boolean value in $WEB_ENV_FILE."

  if command -v timeout >/dev/null 2>&1; then
    timeout 8 bash -lc ":</dev/tcp/$smtp_host/$smtp_port" 2>/dev/null ||
      die "Cannot connect to SMTP_HOST=$smtp_host on SMTP_PORT=$smtp_port from this host."
  else
    echo "WARN: timeout not found; skipping SMTP connectivity check."
  fi
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

  local backend_key frontend_key legacy_frontend_key frontend_host frontend_port frontend_ssl signup_webhook_url
  backend_key="$(read_env_value "$ENV_FILE" "NAKAMA_SOCKET_SERVER_KEY" || true)"
  frontend_key="$(read_env_value "$WEB_ENV_FILE" "NEXT_PUBLIC_NAKAMA_CLIENT_KEY" || true)"
  legacy_frontend_key="$(read_env_value "$WEB_ENV_FILE" "NEXT_PUBLIC_NAKAMA_SERVER_KEY" || true)"
  frontend_host="$(read_env_value "$WEB_ENV_FILE" "NEXT_PUBLIC_NAKAMA_HOST" || true)"
  frontend_port="$(read_env_value "$WEB_ENV_FILE" "NEXT_PUBLIC_NAKAMA_PORT" || true)"
  frontend_ssl="$(read_env_value "$WEB_ENV_FILE" "NEXT_PUBLIC_NAKAMA_USE_SSL" || true)"
  signup_webhook_url="$(read_env_value "$WEB_ENV_FILE" "EARLY_ACCESS_DISCORD_WEBHOOK_URL" || true)"
  if [[ -z "$signup_webhook_url" ]]; then
    signup_webhook_url="$(read_env_value "$WEB_ENV_FILE" "DISCORD_WEBHOOK_URL" || true)"
  fi

  [[ -n "$backend_key" ]] || die "NAKAMA_SOCKET_SERVER_KEY missing in $ENV_FILE"
  [[ -n "$frontend_key" ]] || die "NEXT_PUBLIC_NAKAMA_CLIENT_KEY missing in $WEB_ENV_FILE"
  [[ -z "$legacy_frontend_key" ]] || die "NEXT_PUBLIC_NAKAMA_SERVER_KEY is deprecated. Use NEXT_PUBLIC_NAKAMA_CLIENT_KEY for the public Nakama socket client key."
  [[ -n "$frontend_host" ]] || die "NEXT_PUBLIC_NAKAMA_HOST missing in $WEB_ENV_FILE"
  [[ -n "$frontend_port" ]] || die "NEXT_PUBLIC_NAKAMA_PORT missing in $WEB_ENV_FILE"
  [[ -n "$frontend_ssl" ]] || die "NEXT_PUBLIC_NAKAMA_USE_SSL missing in $WEB_ENV_FILE"
  [[ -n "$signup_webhook_url" ]] || die "EARLY_ACCESS_DISCORD_WEBHOOK_URL missing in $WEB_ENV_FILE. Set it to the Discord webhook URL for signup notifications; DISCORD_WEBHOOK_URL is accepted as a legacy fallback."

  if looks_like_placeholder "$backend_key" || looks_like_placeholder "$frontend_key"; then
    die "Socket server key looks like a placeholder in .env or apps/web/.env.local."
  fi

  for browser_secret in \
    NEXT_PUBLIC_NAKAMA_RUNTIME_HTTP_KEY \
    NEXT_PUBLIC_NAKAMA_SESSION_ENCRYPTION_KEY \
    NEXT_PUBLIC_NAKAMA_SESSION_REFRESH_ENCRYPTION_KEY \
    NEXT_PUBLIC_NAKAMA_CONSOLE_SIGNING_KEY \
    NEXT_PUBLIC_NAKAMA_CONSOLE_PASSWORD; do
    if [[ -n "$(read_env_value "$WEB_ENV_FILE" "$browser_secret" || true)" ]]; then
      die "$browser_secret must not be set in browser env."
    fi
  done

  [[ "$frontend_key" == "$backend_key" ]] || die "Key mismatch: NEXT_PUBLIC_NAKAMA_CLIENT_KEY != NAKAMA_SOCKET_SERVER_KEY."
  [[ "$frontend_host" == "$EXPECTED_NAKAMA_HOST" ]] || die "Bad NEXT_PUBLIC_NAKAMA_HOST=$frontend_host (expected $EXPECTED_NAKAMA_HOST)."
  [[ "$frontend_port" == "$EXPECTED_NAKAMA_PORT" ]] || die "Bad NEXT_PUBLIC_NAKAMA_PORT=$frontend_port (expected $EXPECTED_NAKAMA_PORT)."
  [[ "$frontend_ssl" == "$EXPECTED_NAKAMA_USE_SSL" ]] || die "Bad NEXT_PUBLIC_NAKAMA_USE_SSL=$frontend_ssl (expected $EXPECTED_NAKAMA_USE_SSL)."
  if [[ "$signup_webhook_url" != https://discord.com/api/webhooks/* && "$signup_webhook_url" != https://discordapp.com/api/webhooks/* ]]; then
    die "Signup Discord webhook URL must look like a Discord webhook URL."
  fi
  validate_email_alert_config

  echo "Installing dependencies (including dev deps for Next.js typecheck)..."
  (
    cd "$ROOT_DIR"
    if git ls-files --error-unmatch pnpm-lock.yaml >/dev/null 2>&1; then
      ./scripts/run-pnpm.sh install --frozen-lockfile --prod=false
    else
      ./scripts/run-pnpm.sh install --no-frozen-lockfile --prod=false
    fi
  )

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
  if grep -R -q "Startup sanity check failed" "$ROOT_DIR/apps/web/.next/static/chunks" 2>/dev/null; then
    echo "Local startup sanity-check marker present."
  else
    echo "WARN: Local startup sanity-check marker was not found in built chunks."
  fi

  verify_live_bundle_key "$backend_key"

  echo "Deploy complete."
  echo "Quick verify:"
  echo "CHUNK=\$(curl -sS ${PLAY_URL} | grep -oE '/_next/static/chunks/pages/(play|index)-[^\"]+\\.js' | head -n1)"
  echo "JS=\$(curl -sS \"${PLAY_URL}\$CHUNK\")"
  echo "echo \"\$JS\" | grep -oE '${backend_key:0:8}[0-9a-f]*|37ba066c[0-9a-f]*' | sort -u"
  echo "echo \"\$JS\" | grep -q 'Startup sanity check failed' && echo 'STARTUP_SANITY_CODE=present'"
}

main "$@"
