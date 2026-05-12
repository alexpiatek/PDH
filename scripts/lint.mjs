#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPnpm } from "./lib/pnpm.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(label, command, args) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    return result.error.code === "ENOENT" ? "missing" : result.error;
  }

  if (result.signal) {
    console.error(`${label} stopped by signal ${result.signal}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return "ok";
}

console.log("\n> eslint");
const eslint = runPnpm(["exec", "eslint", "."], { cwd: rootDir });
if (eslint.error) {
  console.error(eslint.error.message);
  process.exit(1);
}
if (eslint.signal) {
  console.error(`eslint stopped by signal ${eslint.signal}`);
  process.exit(1);
}
if (eslint.status !== 0) {
  process.exit(eslint.status ?? 1);
}

const shellScripts = readdirSync(resolve(rootDir, "scripts"))
  .filter((name) => name.endsWith(".sh"))
  .map((name) => `scripts/${name}`);

if (shellScripts.length === 0) {
  process.exit(0);
}

const shellcheck = run("shellcheck", "shellcheck", shellScripts);
if (shellcheck === "missing") {
  console.log("shellcheck not found; skipping shell script lint.");
} else if (shellcheck instanceof Error) {
  console.error(shellcheck.message);
  process.exit(1);
}
