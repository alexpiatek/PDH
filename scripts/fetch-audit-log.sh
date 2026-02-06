#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3002}"
TOKEN="${AUDIT_LOG_TOKEN:-}"
HOST="${AUDIT_LOG_HOST:-localhost}"

if [[ -z "$TOKEN" ]]; then
  echo "AUDIT_LOG_TOKEN is not set. Example:" >&2
  echo "  AUDIT_LOG_TOKEN=supersecret $0" >&2
  exit 1
fi

URL="http://${HOST}:${PORT}/admin/audit-log"

curl -sS -H "x-audit-token: ${TOKEN}" "$URL" | python3 -m json.tool
