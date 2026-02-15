#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

POSTGRES_DB="${POSTGRES_DB:-nakama}"
POSTGRES_USER="${POSTGRES_USER:-nakama}"

timestamp="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"
backup_file="$OUT_DIR/${POSTGRES_DB}-${timestamp}.sql.gz"

echo "Creating backup: $backup_file"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip -9 >"$backup_file"

echo "Pruning backups older than ${RETENTION_DAYS} days in $OUT_DIR"
find "$OUT_DIR" -type f -name '*.sql.gz' -mtime "+$RETENTION_DAYS" -delete

echo "Backup complete."
