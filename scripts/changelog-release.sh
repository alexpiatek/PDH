#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHANGELOG_FILE="$ROOT_DIR/CHANGELOG.md"

if [[ $# -ne 1 ]]; then
  echo "Usage: pnpm run changelog:release -- <version>" >&2
  exit 1
fi

VERSION="$1"
DATE="$(date -u +%Y-%m-%d)"

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be semver (e.g. 0.2.0)" >&2
  exit 1
fi

if ! rg -q '^## \[Unreleased\]' "$CHANGELOG_FILE"; then
  echo "Missing [Unreleased] section in CHANGELOG.md" >&2
  exit 1
fi

if rg -q "^## \[$VERSION\]" "$CHANGELOG_FILE"; then
  echo "Version $VERSION already exists in CHANGELOG.md" >&2
  exit 1
fi

tmp_file="$(mktemp)"
awk -v version="$VERSION" -v date="$DATE" '
BEGIN { inserted = 0 }
{
  print $0
  if ($0 ~ /^## \[Unreleased\]/ && inserted == 0) {
    print ""
    print "## [" version "] - " date
    print ""
    print "### Added"
    print "- _none_"
    print ""
    print "### Changed"
    print "- _none_"
    print ""
    print "### Fixed"
    print "- _none_"
    print ""
    print "### Security"
    print "- _none_"
    inserted = 1
  }
}
' "$CHANGELOG_FILE" >"$tmp_file"

mv "$tmp_file" "$CHANGELOG_FILE"

echo "Prepared CHANGELOG.md for release $VERSION ($DATE)."
