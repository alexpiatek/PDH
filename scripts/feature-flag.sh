#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.dev.yml}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pdh}"

usage() {
  cat <<'EOF'
Usage:
  scripts/feature-flag.sh list
  scripts/feature-flag.sh get <flag-key>
  scripts/feature-flag.sh set <flag-key> <true|false>
  scripts/feature-flag.sh enable <flag-key>
  scripts/feature-flag.sh disable <flag-key>

Examples:
  scripts/feature-flag.sh list
  scripts/feature-flag.sh get ui.table_v2
  scripts/feature-flag.sh set ui.table_v2 true
  scripts/feature-flag.sh enable ui.discard_overlay_v2
EOF
}

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

POSTGRES_DB="${POSTGRES_DB:-nakama}"
POSTGRES_USER="${POSTGRES_USER:-nakama}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-localdb}"

compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

"${compose[@]}" up -d postgres >/dev/null

db_exec() {
  "${compose[@]}" exec -T postgres env PGPASSWORD="$POSTGRES_PASSWORD" \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
}

sql_escape_literal() {
  printf "%s" "$1" | sed "s/'/''/g"
}

normalize_bool() {
  local raw
  raw="$(printf "%s" "$1" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    1|true|yes|on) echo "true" ;;
    0|false|no|off) echo "false" ;;
    *)
      echo "Invalid boolean value: $1" >&2
      exit 1
      ;;
  esac
}

ensure_table_exists() {
  db_exec <<'EOSQL'
CREATE TABLE IF NOT EXISTS public.pdh_feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
EOSQL
}

cmd="${1:-list}"
flag_key="${2:-}"
flag_value="${3:-}"

ensure_table_exists

case "$cmd" in
  list)
    db_exec -c "SELECT key, enabled, description, updated_at FROM public.pdh_feature_flags ORDER BY key;"
    ;;
  get)
    if [[ -z "$flag_key" ]]; then
      usage
      exit 1
    fi
    escaped_key="$(sql_escape_literal "$flag_key")"
    db_exec -c "SELECT key, enabled, description, updated_at FROM public.pdh_feature_flags WHERE key = '$escaped_key';"
    ;;
  set)
    if [[ -z "$flag_key" || -z "$flag_value" ]]; then
      usage
      exit 1
    fi
    escaped_key="$(sql_escape_literal "$flag_key")"
    normalized_value="$(normalize_bool "$flag_value")"
    db_exec -c "INSERT INTO public.pdh_feature_flags (key, enabled, description) VALUES ('$escaped_key', $normalized_value, 'managed via scripts/feature-flag.sh') ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();"
    db_exec -c "SELECT key, enabled, description, updated_at FROM public.pdh_feature_flags WHERE key = '$escaped_key';"
    ;;
  enable)
    if [[ -z "$flag_key" ]]; then
      usage
      exit 1
    fi
    "$0" set "$flag_key" true
    ;;
  disable)
    if [[ -z "$flag_key" ]]; then
      usage
      exit 1
    fi
    "$0" set "$flag_key" false
    ;;
  *)
    usage
    exit 1
    ;;
esac

