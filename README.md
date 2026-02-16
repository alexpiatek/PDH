# PDH - Discard Hold'em

Real-time multiplayer poker with a twist:
you start with 5 hole cards, then discard one after flop, turn, and river, ending on 2-hole-card showdown.

## Play Online

- Web: `https://play.bondipoker.online`
- API health: `https://api.bondipoker.online/healthcheck`

## Why It Is Different

- Classic Hold'em betting structure.
- Mandatory hidden discards after each post-flop street.
- Information pressure: everyone shrinks to 2-hole-card showdown.
- Same game every run: deterministic engine + authoritative server.

## Rules (MVP)

- Standard 52-card deck, 2-9 players.
- Deal 5 hole cards to each player.
- No discards pre-flop.
- Flop -> betting -> each remaining player discards exactly 1 card.
- Turn -> betting -> each remaining player discards exactly 1 card.
- River -> betting -> each remaining player discards exactly 1 card.
- Players reach showdown with 2 hole cards.
- Best 5-card hand from 2 hole + 5 board wins.
- Discards are face-down and never revealed.
- No-limit betting, standard min-raise behavior.

## Tech Stack

- TypeScript monorepo with `pnpm`.
- `packages/engine`: pure deterministic poker engine.
- `apps/nakama`: authoritative runtime module for Nakama.
- `apps/web`: Next.js client.
- `apps/server`: legacy WebSocket backend (optional fallback).

## QUICKSTART (Local Dev, 30 Minutes)

Single source of truth: `docs/LOCAL_DEV.md`.

Run from repo root:

```bash
pnpm install
cp -n .env.example .env
cp -n apps/web/.env.local.example apps/web/.env.local
pnpm run dev:full
```

Open `http://localhost:3001`.

Notes:

- Local stack is Next.js + Nakama + Postgres.
- Caddy is production-only and is not needed for local development.

## Local URLs

- Web: `http://localhost:3001`
- Nakama API: `http://localhost:7350`
- Nakama console: `http://localhost:7351`
- Legacy WS (optional): `ws://localhost:3002`

## Production Deployment

Use these guides:

- `CONTRIBUTING.md` (branch/PR conventions, golden path, review checklist)
- `docs/DEFINITION_OF_DONE.md` (feature completion checklist)
- `CHANGELOG.md` (Keep a Changelog release notes)
- `docs/LOCAL_DEV.md` (local development commands + troubleshooting)
- `docs/INTEGRATION_TESTS.md` (local integration test harness and troubleshooting)
- `docs/E2E_TESTS.md` (Playwright end-to-end test harness and troubleshooting)
- `docs/ENGINE_CONTRACT.md` (PDH engine state machine + validation contract)
- `docs/PROTOCOL_CONTRACT.md` (versioned client/server payload contract)
- `docs/DATABASE_MIGRATIONS.md` (SQL migration + deterministic seed strategy)
- `docs/ONBOARDING_30_MIN.md` (fast start for new contributors)
- `docs/PROD_RUNBOOK.md` (exact end-to-end production flow used for `bondipoker.online`)
- `docs/QUICK_FIX.md` (fastest safe recovery commands for production connection failures)
- `docs/TROUBLESHOOTING.md` (production issue diagnosis and fix commands)
- `docs/NON_ROOT_MIGRATION.md` (move production off root user)
- `docs/MONITORING_ALERTING.md` (uptime, host metrics, alerting baseline)
- `docs/BACKUP_RESTORE.md` (daily backup + restore drill)
- `docs/DEPLOY_OCI.md` (OCI-specific deployment checklist)
- `deploy/README.md` (expected ports/routes/proxy rules for Caddy + realtime)
- `deploy/PROD_CHECKLIST.md` (quick production readiness checklist)
- `deploy/Caddyfile.example` (safe baseline Caddy config)

## Test + Smoke

```bash
make test
make smoke
pnpm run test:integration
```

## Standard Commands

```bash
pnpm run dev        # legacy websocket stack
pnpm run up         # start Postgres + Nakama (Docker)
pnpm run dev:web    # start Next.js client only
pnpm run dev:full   # start backend then Next.js client
pnpm run test
pnpm run lint
pnpm run typecheck
pnpm run build
```

## Quality Commands

```bash
pnpm run lint
pnpm run format
pnpm run format:check
pnpm run typecheck
pnpm run test:e2e
pnpm run changelog:check
pnpm run db:migrate
pnpm run db:seed
pnpm run db:flag -- list
pnpm run db:flag -- set ui.table_v2 true
```

Remote smoke test:

```bash
SMOKE_SERVER_KEY='<nakama_socket_server_key>' ./scripts/remote-smoke.sh --url https://api.bondipoker.online --ssl true --clients 4
```

## Audit Log (Admin Only)

Server keeps an in-memory audit trail for the last 5 hands (discards, showdown cards, pot, stacks, winners).

Enable when running legacy server:

```bash
AUDIT_LOG_TOKEN=supersecret pnpm dev
```

Fetch (local):

```bash
AUDIT_LOG_TOKEN=supersecret scripts/fetch-audit-log.sh
```

Fetch (remote via SSH tunnel):

```bash
scripts/ssh-audit-tunnel.sh user@your-server 3002 3002
AUDIT_LOG_TOKEN=supersecret scripts/fetch-audit-log.sh
```

## Repo Layout

```text
apps/web         Next.js game client
apps/nakama      Nakama runtime module
apps/server      Legacy WebSocket server
packages/engine  Core deterministic poker engine
tools/smoke      Multiplayer smoke tester
```
