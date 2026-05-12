#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPnpm } from "./lib/pnpm.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Keep this aligned with the repo's current compile contract.
// Full strict TS checks are not yet enabled across all packages.
const checks = [
  ["protocol typecheck", ["-C", "packages/protocol", "typecheck"]],
  ["engine build", ["-C", "packages/engine", "build"]],
  ["nakama build", ["-C", "apps/nakama", "build"]],
  ["web typecheck", ["exec", "tsc", "-p", "apps/web/tsconfig.json", "--noEmit"]],
];

for (const [label, args] of checks) {
  console.log(`\n> ${label}`);
  const result = runPnpm(args, { cwd: rootDir });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.signal) {
    console.error(`typecheck stopped by signal ${result.signal}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
