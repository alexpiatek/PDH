#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/apps/web/public/cards/english-pattern"

mkdir -p "$OUT_DIR"

ranks=(ace 2 3 4 5 6 7 8 9 10 jack queen king)
suits=(spades hearts diamonds clubs)

for r in "${ranks[@]}"; do
  for s in "${suits[@]}"; do
    url="https://commons.wikimedia.org/wiki/Special:FilePath/English_pattern_${r}_of_${s}.svg"
    out="$OUT_DIR/english_pattern_${r}_of_${s}.svg"
    if [ ! -f "$out" ]; then
      echo "Downloading $out"
      curl -sSL "$url" -o "$out"
    fi
    # Strip the default white background/border rect so CSS controls the card edge.
    perl -0777 -i -pe 's/\s*<rect[^>]*id="rect6472[^"]*"[^>]*?\/>//s' "$out"
  done
done
