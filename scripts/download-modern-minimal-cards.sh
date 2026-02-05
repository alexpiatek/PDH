#!/usr/bin/env bash
# Source deck: "Jumbo Index Playing Cards" (public domain/CC0) on OpenGameArt.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="$ROOT_DIR/apps/web/public/cards/modern-minimal"
TMP_DIR="$(mktemp -d)"
ARCHIVE="$TMP_DIR/modern-minimal-deck.zip"
SOURCE_URL="https://opengameart.org/sites/default/files/Decks.zip"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$TMP_DIR"

if command -v curl >/dev/null 2>&1; then
  curl -L --fail --retry 3 -o "$ARCHIVE" "$SOURCE_URL"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$ARCHIVE" "$SOURCE_URL"
else
  echo "Error: curl or wget is required to download card assets." >&2
  exit 1
fi

unzip -q "$ARCHIVE" -d "$TMP_DIR"

SRC_DIR="$(find "$TMP_DIR" -type d -path "*/Decks/Vertical2/pngs" -print -quit)"
if [[ -z "$SRC_DIR" ]]; then
  SRC_DIR="$(find "$TMP_DIR" -type d -path "*/Vertical2/pngs" -print -quit)"
fi
if [[ -z "$SRC_DIR" ]]; then
  echo "Error: could not locate Vertical2/pngs in downloaded deck." >&2
  exit 1
fi

rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"

export SRC_DIR DEST_DIR
python3 - <<'PY'
import os
import re
import shutil
import sys

src_dir = os.environ["SRC_DIR"]
dest_dir = os.environ["DEST_DIR"]

rank_words = {
    "ace": "ace",
    "a": "ace",
    "king": "king",
    "k": "king",
    "queen": "queen",
    "q": "queen",
    "jack": "jack",
    "j": "jack",
    "ten": "10",
    "t": "10",
    "10": "10",
    "9": "9",
    "8": "8",
    "7": "7",
    "6": "6",
    "5": "5",
    "4": "4",
    "3": "3",
    "2": "2",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
}

suit_words = {
    "spade": "spades",
    "spades": "spades",
    "s": "spades",
    "heart": "hearts",
    "hearts": "hearts",
    "h": "hearts",
    "diamond": "diamonds",
    "diamonds": "diamonds",
    "d": "diamonds",
    "club": "clubs",
    "clubs": "clubs",
    "c": "clubs",
}

skip_tokens = ("joker", "back", "cover", "rear")

unmatched = []
written = []

for filename in os.listdir(src_dir):
    if not filename.lower().endswith(".png"):
        continue
    base = os.path.splitext(filename)[0]
    lower = base.lower()

    if any(token in lower for token in skip_tokens):
        continue

    rank = None
    suit = None

    # Short form, e.g., AS, 10H, td
    m = re.match(r"^(10|[2-9]|[ajkqt])([shdc])$", lower)
    if m:
        rank = rank_words.get(m.group(1))
        suit = suit_words.get(m.group(2))

    # Short form reversed, e.g., SA
    if not rank or not suit:
        m = re.match(r"^([shdc])(10|[2-9]|[ajkqt])$", lower)
        if m:
            suit = suit_words.get(m.group(1))
            rank = rank_words.get(m.group(2))

    # Word form, e.g., spadeAce, ace_of_spades, diamondTen
    if not rank or not suit:
        compact = re.sub(r"[^a-z0-9]", "", lower)
        m = re.match(r"^(spade|heart|diamond|club)(ace|king|queen|jack|ten|[2-9]|10|two|three|four|five|six|seven|eight|nine)$", compact)
        if m:
            suit = suit_words.get(m.group(1))
            rank = rank_words.get(m.group(2))

    if not rank or not suit:
        m = re.match(r"^(ace|king|queen|jack|ten|[2-9]|10|two|three|four|five|six|seven|eight|nine)(spade|spades|heart|hearts|diamond|diamonds|club|clubs)$", compact)
        if m:
            rank = rank_words.get(m.group(1))
            suit = suit_words.get(m.group(2))

    # Fallback token search
    if not rank or not suit:
        for key in ("spades", "spade", "hearts", "heart", "diamonds", "diamond", "clubs", "club"):
            if key in lower:
                suit = suit_words[key]
                break
        for key in ("ace", "king", "queen", "jack", "ten", "10", "9", "8", "7", "6", "5", "4", "3", "2",
                    "two", "three", "four", "five", "six", "seven", "eight", "nine"):
            if key in lower:
                rank = rank_words[key]
                break

    if not rank or not suit:
        unmatched.append(filename)
        continue

    target_name = f"{rank}_of_{suit}.png"
    src_path = os.path.join(src_dir, filename)
    dest_path = os.path.join(dest_dir, target_name)
    shutil.copy2(src_path, dest_path)
    written.append(target_name)

unique_written = sorted(set(written))

if len(unique_written) != 52:
    print(f"Warning: expected 52 cards, wrote {len(unique_written)}", file=sys.stderr)
    if unmatched:
        print("Unmatched files:", file=sys.stderr)
        for name in unmatched:
            print(f"  - {name}", file=sys.stderr)
PY

echo "Modern minimal deck installed to: $DEST_DIR"
