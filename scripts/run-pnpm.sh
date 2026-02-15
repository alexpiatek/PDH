#!/usr/bin/env bash
set -euo pipefail

for node_bin in \
  "$HOME/.local/node20/bin" \
  "$HOME/.local/node/bin"
do
  if [[ -x "$node_bin/node" ]]; then
    export PATH="$node_bin:$PATH"
    break
  fi
done

if command -v pnpm >/dev/null 2>&1; then
  if pnpm --version >/dev/null 2>&1; then
    exec pnpm "$@"
  fi
fi

if command -v cmd.exe >/dev/null 2>&1; then
  exec cmd.exe /c pnpm "$@"
fi

echo "pnpm is not available on PATH." >&2
echo "Install Node.js + pnpm, or run from Windows via cmd.exe in WSL." >&2
exit 1
