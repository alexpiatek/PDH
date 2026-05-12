#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = resolve(rootDir, "CHANGELOG.md");

let changelog;
try {
  changelog = readFileSync(changelogPath, "utf8");
} catch (error) {
  console.error("Missing CHANGELOG.md");
  process.exit(1);
}

if (!/^## \[Unreleased\]/m.test(changelog)) {
  console.error("CHANGELOG.md must include an [Unreleased] section.");
  process.exit(1);
}

if (!/^### (Added|Changed|Fixed|Security)$/m.test(changelog)) {
  console.error("CHANGELOG.md should include Keep a Changelog headings (Added/Changed/Fixed/Security).");
  process.exit(1);
}

console.log("changelog: format looks valid");
