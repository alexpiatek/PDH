#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPnpm, spawnPnpm } from "./lib/pnpm.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const webPort = process.env.E2E_WEB_PORT ?? "3001";
const nakamaPort = process.env.E2E_NAKAMA_HTTP_PORT ?? "18350";
const nakamaServerKey =
  process.env.E2E_NAKAMA_SERVER_KEY ?? "e2e_socket_server_key_local_1234567890";
const matchModule = process.env.E2E_NAKAMA_MATCH_MODULE ?? "pdh";
const tableId = process.env.E2E_NAKAMA_TABLE_ID ?? "main";

const webEnv = {
  ...process.env,
  NEXT_PUBLIC_NETWORK_BACKEND: "nakama",
  NEXT_PUBLIC_NAKAMA_HOST: "127.0.0.1",
  NEXT_PUBLIC_NAKAMA_PORT: nakamaPort,
  NEXT_PUBLIC_NAKAMA_USE_SSL: "false",
  NEXT_PUBLIC_NAKAMA_CLIENT_KEY: nakamaServerKey,
  NEXT_PUBLIC_NAKAMA_MATCH_MODULE: matchModule,
  NEXT_PUBLIC_NAKAMA_TABLE_ID: tableId,
  PDH_ENABLE_TEST_POKER_STATE: "1",
};

const build = runPnpm(["-C", "apps/web", "build"], {
  cwd: rootDir,
  env: webEnv,
});

if (build.error) {
  console.error(build.error.message);
  process.exit(1);
}

if (build.signal) {
  console.error(`web build stopped by signal ${build.signal}`);
  process.exit(1);
}

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

let stopping = false;

const server = spawnPnpm(["-C", "apps/web", "start", "--port", webPort], {
  cwd: rootDir,
  env: webEnv,
});

server.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

server.on("exit", (code, signal) => {
  if (signal) {
    process.exit(stopping ? 0 : 1);
    return;
  }

  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    if (!server.killed) {
      server.kill(signal);
    }
  });
}
