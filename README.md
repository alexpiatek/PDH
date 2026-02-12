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

## Quick Start (Local Nakama)

```bash
pnpm install
cp .env.example .env
./scripts/dev-up.sh
cp apps/web/.env.local.example apps/web/.env.local
pnpm -C apps/web dev --port 3001
```

Open `http://localhost:3001`.

## Local URLs

- Web: `http://localhost:3001`
- Nakama API: `http://localhost:7350`
- Nakama console: `http://localhost:7351`
- Legacy WS (optional): `ws://localhost:3002`

## Production Deployment

Use these guides:

- `docs/PROD_RUNBOOK.md` (exact end-to-end production flow used for `bondipoker.online`)
- `docs/DEPLOY_OCI.md` (OCI-specific deployment checklist)

## Test + Smoke

```bash
make test
make smoke
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
