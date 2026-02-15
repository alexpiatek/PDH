import { defineConfig, devices } from '@playwright/test';

const webPort = process.env.E2E_WEB_PORT ?? '3001';
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${webPort}`;
const nakamaPort = process.env.E2E_NAKAMA_HTTP_PORT ?? '18350';
const nakamaServerKey =
  process.env.E2E_NAKAMA_SERVER_KEY ?? 'e2e_socket_server_key_local_1234567890';
const managedWebServer = process.env.E2E_MANAGED_WEB_SERVER === '1';
const webServerTimeoutMs = Number.parseInt(process.env.E2E_WEB_SERVER_TIMEOUT_MS ?? '300000', 10);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: managedWebServer
    ? undefined
    : {
        command:
          `NEXT_PUBLIC_NETWORK_BACKEND=nakama ` +
          `NEXT_PUBLIC_NAKAMA_HOST=127.0.0.1 ` +
          `NEXT_PUBLIC_NAKAMA_PORT=${nakamaPort} ` +
          `NEXT_PUBLIC_NAKAMA_USE_SSL=false ` +
          `NEXT_PUBLIC_NAKAMA_SERVER_KEY=${nakamaServerKey} ` +
          `NEXT_PUBLIC_NAKAMA_MATCH_MODULE=pdh ` +
          `NEXT_PUBLIC_NAKAMA_TABLE_ID=main ` +
          `./scripts/run-pnpm.sh -C apps/web build && ` +
          `NEXT_PUBLIC_NETWORK_BACKEND=nakama ` +
          `NEXT_PUBLIC_NAKAMA_HOST=127.0.0.1 ` +
          `NEXT_PUBLIC_NAKAMA_PORT=${nakamaPort} ` +
          `NEXT_PUBLIC_NAKAMA_USE_SSL=false ` +
          `NEXT_PUBLIC_NAKAMA_SERVER_KEY=${nakamaServerKey} ` +
          `NEXT_PUBLIC_NAKAMA_MATCH_MODULE=pdh ` +
          `NEXT_PUBLIC_NAKAMA_TABLE_ID=main ` +
          `./scripts/run-pnpm.sh -C apps/web start --port ${webPort}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: Number.isFinite(webServerTimeoutMs) ? webServerTimeoutMs : 300_000,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
