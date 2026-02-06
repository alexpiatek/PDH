#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 user@host [local_port] [remote_port]" >&2
  echo "Example: $0 ubuntu@example.com 3002 3002" >&2
  exit 1
fi

REMOTE="$1"
LOCAL_PORT="${2:-3002}"
REMOTE_PORT="${3:-3002}"

ssh -L "${LOCAL_PORT}:localhost:${REMOTE_PORT}" "$REMOTE"
