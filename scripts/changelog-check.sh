#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHANGELOG_FILE="$ROOT_DIR/CHANGELOG.md"

if [[ ! -f "$CHANGELOG_FILE" ]]; then
  echo "Missing CHANGELOG.md" >&2
  exit 1
fi

if ! rg -q '^## \[Unreleased\]' "$CHANGELOG_FILE"; then
  echo "CHANGELOG.md must include an [Unreleased] section." >&2
  exit 1
fi

if ! rg -q '^### Added|^### Changed|^### Fixed|^### Security' "$CHANGELOG_FILE"; then
  echo "CHANGELOG.md should include Keep a Changelog headings (Added/Changed/Fixed/Security)." >&2
  exit 1
fi

echo "changelog: format looks valid"
