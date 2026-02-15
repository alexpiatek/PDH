#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/apps/web/public/cards/english-pattern-png"
TMP_DIR="$(mktemp -d)"
ZIP_PATH="$TMP_DIR/playing-cards.zip"

mkdir -p "$OUT_DIR"

echo "Downloading card pack..."
curl -sSL "https://opengameart.org/sites/default/files/Playing%20Cards.zip" -o "$ZIP_PATH"

echo "Extracting..."
unzip -qq "$ZIP_PATH" -d "$TMP_DIR/unzip"

echo "Collecting PNGs..."
count=0
find "$TMP_DIR/unzip" -type f -iname "*.png" | while read -r file; do
  name="$(basename "$file")"
  name_lc="$(echo "$name" | tr 'A-Z' 'a-z')"
  if [[ "$name_lc" =~ (ace|king|queen|jack|ten|10|9|8|7|6|5|4|3|2)[^a-z0-9]*(spades|hearts|diamonds|clubs) ]]; then
    rank="${BASH_REMATCH[1]}"
    suit="${BASH_REMATCH[2]}"
    case "$rank" in
      ten) rank="10" ;;
    esac
    out="$OUT_DIR/english_pattern_${rank}_of_${suit}.png"
    cp "$file" "$out"
    count=$((count + 1))
  fi
done

echo "Saved $count card images to $OUT_DIR"
