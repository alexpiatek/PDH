#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.dev.yml}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-pdh}"
SEEDS_DIR="${SEEDS_DIR:-$ROOT_DIR/db/seeds}"
FORCE=0

if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

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

if [[ ! -d "$SEEDS_DIR" ]]; then
  echo "No seeds directory at $SEEDS_DIR"
  exit 0
fi

mapfile -t seed_files < <(find "$SEEDS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)
if [[ ${#seed_files[@]} -eq 0 ]]; then
  echo "No seed files found in $SEEDS_DIR"
  exit 0
fi

compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

"${compose[@]}" up -d postgres >/dev/null

db_exec() {
  "${compose[@]}" exec -T postgres env PGPASSWORD="$POSTGRES_PASSWORD" \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
}

db_exec <<'EOSQL'
CREATE TABLE IF NOT EXISTS public.app_seed_runs (
  seed_name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
EOSQL

for file in "${seed_files[@]}"; do
  seed_name="$(basename "$file")"
  checksum="$(sha256sum "$file" | awk '{print $1}')"
  applied_checksum="$(db_exec -tAc "SELECT checksum FROM public.app_seed_runs WHERE seed_name = '$seed_name'" | tr -d '[:space:]')"

  if [[ -n "$applied_checksum" && "$applied_checksum" == "$checksum" ]]; then
    echo "skip $seed_name (already applied)"
    continue
  fi

  if [[ -n "$applied_checksum" && "$applied_checksum" != "$checksum" && "$FORCE" -ne 1 ]]; then
    echo "Seed file changed since last apply: $seed_name" >&2
    echo "Re-run with --force to apply updated seed." >&2
    exit 1
  fi

  echo "apply $seed_name"
  db_exec <"$file"
  db_exec -c "INSERT INTO public.app_seed_runs (seed_name, checksum, applied_at) VALUES ('$seed_name', '$checksum', now()) ON CONFLICT (seed_name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = EXCLUDED.applied_at;"
done

echo "seeding complete"
