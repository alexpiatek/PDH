import { spawn, spawnSync } from "node:child_process";

function quoteForCmd(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=+-]+$/.test(text)) {
    return text;
  }

  return `"${text.replace(/(["^&|<>%])/g, "^$1")}"`;
}

function pnpmCandidates(args) {
  const normalizedArgs = args.map(String);

  if (process.platform === "win32") {
    return [
      ["cmd.exe", ["/d", "/s", "/c", ["pnpm", ...normalizedArgs].map(quoteForCmd).join(" ")]],
    ];
  }

  return [
    ["pnpm", normalizedArgs],
    ["cmd.exe", ["/c", ["pnpm", ...normalizedArgs].map(quoteForCmd).join(" ")]],
  ];
}

export function runPnpm(args, options = {}) {
  let lastError;

  for (const [command, commandArgs] of pnpmCandidates(args)) {
    const result = spawnSync(command, commandArgs, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.stdio ?? "inherit",
    });

    if (result.error?.code === "ENOENT") {
      lastError = result.error;
      continue;
    }

    return result;
  }

  return { status: 1, error: lastError };
}

export function spawnPnpm(args, options = {}) {
  const [[command, commandArgs]] = pnpmCandidates(args);

  return spawn(command, commandArgs, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
  });
}
