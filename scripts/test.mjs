#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPnpm } from "./lib/pnpm.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const checks = [
  ["protocol tests", ["-C", "packages/protocol", "test"]],
  ["engine tests", ["-C", "packages/engine", "test"]],
  ["nakama unit tests", ["-C", "apps/nakama", "test:unit"]],
];

for (const [label, args] of checks) {
  console.log(`\n> ${label}`);
  const result = runPnpm(args, { cwd: rootDir });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.signal) {
    console.error(`test stopped by signal ${result.signal}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
