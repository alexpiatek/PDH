# E2E Tests (Playwright)

`pnpm test:e2e` runs browser E2E tests against a local Nakama + Postgres stack.

## What happens

1. Builds `apps/nakama` runtime JS.
2. Starts Postgres + Nakama (isolated ports) via `docker-compose.test.yml`.
3. Starts `apps/web` dev server on an isolated port for the test run.
4. Runs Playwright tests headless in Chromium.
5. Tears down Docker and web resources on exit.

## Run

```bash
pnpm test:e2e
```

## Defaults

- Ports are auto-selected per run to avoid local conflicts.
- Runner prints selected ports before starting services.

## Override ports

```bash
E2E_NAKAMA_HTTP_PORT=28350 \
E2E_NAKAMA_CONSOLE_PORT=28351 \
E2E_POSTGRES_PORT=26432 \
E2E_WEB_PORT=3301 \
pnpm test:e2e
```

## Troubleshooting

- Browser binary missing:
  - `pnpm exec playwright install chromium`
- Nakama health timeout:
  - `docker compose -f docker-compose.test.yml logs --tail=200 nakama postgres`
- App cannot connect to Nakama:
  - Check `NAKAMA_SOCKET_SERVER_KEY` mismatch and exposed ports.
- Existing local Next.js process detected:
  - Stop `apps/web` dev/start processes, then rerun `pnpm test:e2e`.
- Flaky local machine:
  - Re-run once; tests use explicit UI state waits for websocket-driven updates.
