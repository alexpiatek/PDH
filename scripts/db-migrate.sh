#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.dev.yml}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pdh}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$ROOT_DIR/db/migrations}"

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

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "No migrations directory at $MIGRATIONS_DIR"
  exit 0
fi

migration_files=()
while IFS= read -r file; do
  migration_files+=("$file")
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)

if [[ ${#migration_files[@]} -eq 0 ]]; then
  echo "No migration files found in $MIGRATIONS_DIR"
  exit 0
fi

compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

"${compose[@]}" up -d postgres >/dev/null

sha256_file() {
  local file="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi

  echo "No SHA-256 tool found (expected sha256sum or shasum)." >&2
  exit 1
}

db_exec() {
  "${compose[@]}" exec -T postgres env PGPASSWORD="$POSTGRES_PASSWORD" \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
}

db_exec <<'EOSQL'
CREATE TABLE IF NOT EXISTS public.app_schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
EOSQL

for file in "${migration_files[@]}"; do
  version="$(basename "$file")"
  checksum="$(sha256_file "$file")"
  applied_checksum="$(db_exec -tAc "SELECT checksum FROM public.app_schema_migrations WHERE version = '$version'" | tr -d '[:space:]')"

  if [[ -n "$applied_checksum" ]]; then
    if [[ "$applied_checksum" != "$checksum" ]]; then
      echo "Checksum mismatch for already-applied migration $version" >&2
      echo "Applied: $applied_checksum" >&2
      echo "Current: $checksum" >&2
      exit 1
    fi
    echo "skip $version (already applied)"
    continue
  fi

  echo "apply $version"
  db_exec <"$file"
  db_exec -c "INSERT INTO public.app_schema_migrations (version, checksum) VALUES ('$version', '$checksum');"
done

echo "migrations complete"
