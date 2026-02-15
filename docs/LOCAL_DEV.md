# Local Dev

This is the single source of truth for local development.

## Architecture (Local)

- Next.js client: `apps/web` on `http://localhost:3001`
- Nakama API/WebSocket: `http://127.0.0.1:7350`
- Postgres (for Nakama + app-owned tables): `127.0.0.1:5432`
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
pnpm run up
```

Then start the client:

```bash
pnpm run dev:web
```

Open `http://localhost:3001`.

One-command boot (backend + frontend):

```bash
pnpm run dev:full
```

## Daily Commands

- Start backend (Postgres + Nakama + migrations): `pnpm run up` (or `make up`)
- Start frontend dev server: `pnpm run dev:web` (or `make dev`)
- One-command boot: `pnpm run dev:full`
- Tail backend logs: `pnpm run logs` (or `make logs`)
- Stop backend: `pnpm run down` (or `make down`)
- Run tests: `pnpm run test` (or `make test`)
- Run integration tests only: `pnpm run test:integration`
- Run end-to-end browser tests: `pnpm run test:e2e`
- Run lint baseline: `pnpm run lint` (or `make lint`)
- Run type checks: `pnpm run typecheck` (or `make typecheck`)
- Run SQL migrations manually: `pnpm run db:migrate`
- Apply deterministic seed data manually: `pnpm run db:seed`
- Build all apps: `pnpm run build` (or `make build`)

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
