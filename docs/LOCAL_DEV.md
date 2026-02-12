# Local Dev

This is the single source of truth for local development.

## Architecture (Local)

- Next.js client: `apps/web` on `http://localhost:3001`
- Nakama API/WebSocket: `http://127.0.0.1:7350`
- Postgres (for Nakama): `127.0.0.1:5432`
- Caddy: not required for local dev (production only)

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (Desktop or Engine)

## First Run (30 Minutes)

```bash
pnpm install
cp -n .env.example .env
cp -n apps/web/.env.local.example apps/web/.env.local
make up
```

Then start the client:

```bash
make dev
```

Open `http://localhost:3001`.

## Daily Commands

- Start backend (Postgres + Nakama + migrations): `make up`
- Start frontend dev server: `make dev`
- Tail backend logs: `make logs`
- Stop backend: `make down`
- Run tests: `make test`
- Run lint baseline: `make lint`
- Run type checks: `make typecheck`
- Build all apps: `make build`

## Troubleshooting

- Nakama health check:
  - `curl -i http://127.0.0.1:7350/healthcheck`
- Container status:
  - `docker compose --env-file .env -f docker-compose.dev.yml ps`
- Full environment diagnostic:
  - `make check`
- If ports are busy (5432/7350/7351): stop local services using those ports, then rerun `make up`.
- If auth fails on first run: verify the keys match:
  - `grep -n '^NAKAMA_SOCKET_SERVER_KEY=' .env`
  - `grep -n '^NEXT_PUBLIC_NAKAMA_SERVER_KEY=' apps/web/.env.local`
