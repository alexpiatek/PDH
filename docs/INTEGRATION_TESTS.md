# How Integration Tests Work

The integration suite validates PDH behavior against a real Nakama + Postgres stack using Docker Compose.

## What `pnpm test:integration` does

1. Builds the Nakama runtime module (`apps/nakama/dist/pdh.js`).
2. Starts `postgres` from `docker-compose.test.yml` on isolated test ports.
3. Runs Nakama DB migrations.
4. Starts Nakama and waits for `/healthcheck`.
5. Runs Vitest tests in `tools/integration/src/pdh.integration.test.ts`.
6. Always tears down containers and test volumes.

The tests exercise these flows through Nakama APIs (REST auth + websocket match APIs):

- register/login two users (device auth create=true, then create=false)
- create an authoritative PDH match
- join both players and seat them in-game
- send game actions and assert preflop -> flop betting transition
- verify illegal actions are rejected (`Not your turn`)
- disconnect/reconnect a socket and assert state sync after reconnect

## Run Locally

```bash
pnpm test:integration
```

## Port Isolation

Defaults avoid the local dev stack:

- Nakama HTTP: `17350`
- Nakama console: `17351`
- Postgres: `15432`

Override if needed:

```bash
INTEGRATION_NAKAMA_HTTP_PORT=27350 \
INTEGRATION_NAKAMA_CONSOLE_PORT=27351 \
INTEGRATION_POSTGRES_PORT=25432 \
pnpm test:integration
```

## Troubleshooting

- Docker daemon not running:
  - Start Docker Desktop/Engine, then rerun.
- Healthcheck timeout:
  - Check logs: `docker compose -f docker-compose.test.yml logs --tail=200 nakama postgres`
  - Confirm ports are free or override integration ports.
- Auth failures (`401`/`403`):
  - Ensure `.env` `NAKAMA_SOCKET_SERVER_KEY` matches expected local key.
- Migration failure:
  - Check DB address/env values in `.env`.
  - Retry after cleanup: `docker compose -f docker-compose.test.yml down -v`.
- Intermittent socket failures:
  - Rerun once to rule out local startup race.
  - If persistent, capture Nakama logs and failing test output.
