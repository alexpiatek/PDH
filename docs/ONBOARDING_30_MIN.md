# PDH Onboarding (30 Minutes)

This guide is for first-time contributors who want to:

1. Run the game locally.
2. Understand the production setup at a high level.
3. Know the minimum commands to verify everything works.

If you only have 30 minutes, follow this exactly.

## What You Will Learn

- How PDH is structured.
- How to start local Nakama + web client.
- How production is wired with domains (`play.*` and `api.*`).
- How to smoke test multiplayer quickly.

## 0) Mental Model (2 minutes)

PDH in production is:

`Browser -> Caddy (TLS 443) -> Next.js (3001) + Nakama (7350) -> Postgres (5432)`

- `play.<domain>` serves the web app.
- `api.<domain>` serves Nakama API/WebSocket traffic.

## 1) Local Run (10 minutes)

Run from repo root.

### Prereqs

- Node 20+
- pnpm
- Docker Desktop / Docker Engine

### Commands

```bash
pnpm install
cp .env.example .env
./scripts/dev-up.sh
cp apps/web/.env.local.example apps/web/.env.local
pnpm -C apps/web dev --port 3001
```

Open:

- `http://localhost:3001`

Quick checks:

```bash
curl -i http://127.0.0.1:7350/healthcheck
docker compose --env-file .env -f docker-compose.dev.yml ps
```

## 2) Production Flow (15 minutes overview)

Full details: `docs/PROD_RUNBOOK.md`

These are the key steps everyone should know:

1. DNS points both `play.<domain>` and `api.<domain>` to the VPS IP.
2. Backend env (`/root/PDH/.env`) is created from `.env.example` with secure values.
3. Build order matters:
   - `./scripts/run-pnpm.sh -C packages/engine build`
   - `./scripts/run-pnpm.sh -C apps/nakama build`
4. Start backend:
   - Postgres
   - Nakama migration
   - Nakama
5. Build web app and run it as systemd service (`pdh-web` on port 3001).
6. Caddy routes:
   - `play.<domain>` -> `127.0.0.1:3001`
   - `api.<domain>` -> `127.0.0.1:7350`
7. Verify:
   - `curl -I https://play.<domain>`
   - `curl -i https://api.<domain>/healthcheck`

## 3) Smoke Test (3 minutes)

Local:

```bash
./scripts/smoke.sh --host 127.0.0.1 --port 7350 --ssl false --clients 4
```

Remote:

```bash
SMOKE_SERVER_KEY='<nakama_socket_server_key>' ./scripts/remote-smoke.sh --url https://api.<domain> --ssl true --clients 4
```

Expected result includes:

- `PASS: multiplayer smoke test succeeded`

## 4) Common Errors and Fast Fixes

### `service "nakama-migrate" didn't complete successfully`

- Check `.env` for malformed or duplicate `NAKAMA_DATABASE_ADDRESS`.
- Ensure password inside DB address matches `POSTGRES_PASSWORD`.

### `JavaScript entrypoint ... pdh.js: no such file`

- Build missing runtime bundle:
  - `./scripts/run-pnpm.sh -C packages/engine build`
  - `./scripts/run-pnpm.sh -C apps/nakama build`
- Confirm file exists:
  - `ls -la apps/nakama/dist/pdh.js`

### PowerShell `curl` asks for `Uri`

Use `curl.exe` in PowerShell:

```powershell
curl.exe -i http://127.0.0.1:7350/healthcheck
```

## 5) Day-2 Ops Commands

Production status:

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
docker compose --env-file .env -f docker-compose.prod.yml logs -f nakama
journalctl -u pdh-web -f
journalctl -u caddy -f
```

Health:

```bash
curl -i https://api.<domain>/healthcheck
```

## 6) Teach-Back Script (for onboarding others)

Use this short explanation:

"PDH uses Nakama as the authoritative game backend and Next.js as the client.  
In production, Caddy handles HTTPS and routes `play` to Next.js and `api` to Nakama.  
Postgres stores backend state. The critical build dependency is engine first, then Nakama runtime, then bring up containers and verify with healthcheck and smoke test."

## 7) Security Reminder

- Never commit `.env` files.
- Rotate any key that was ever shared in chat/logs.
- Keep `5432`, `7350`, `7351` closed publicly unless explicitly needed.
