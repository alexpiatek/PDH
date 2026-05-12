# Bondi Poker

Bondi Poker is real-time multiplayer Discard Hold'em.

Players start with 5 hole cards, bet through a familiar no-limit Hold'em flow, discard 1 hidden card after the flop, turn, and river, then reach showdown with 2 hole cards.

## Live Game

- Landing: `https://bondipoker.online/`
- Play lobby: `https://bondipoker.online/play`
- Play subdomain: `https://play.bondipoker.online`
- API health: `https://api.bondipoker.online/healthcheck`

Production tracks `main`.

## Game Flow

1. 2-9 players sit at a table.
2. Each player is dealt 5 private hole cards.
3. Pre-flop betting runs like no-limit Hold'em.
4. The flop is dealt, betting completes, then each remaining player discards 1 hidden card.
5. The turn is dealt, betting completes, then each remaining player discards 1 hidden card.
6. The river is dealt, betting completes, then each remaining player discards 1 hidden card.
7. Showdown uses the best 5-card hand from each player's final 2 hole cards plus the 5 board cards.
8. Discards stay face-down and are never revealed.

## Current Player Experience

- Quick Play finds or creates the best available table.
- Players can join friends with a 6-character table code.
- Recent tables are saved locally in the browser.
- The game table is compact and playable on mobile and desktop.
- Player actions come from server-sent `legalActions` in Nakama mode.
- Hidden discard prompts, showdown results, and next-hand readiness are handled in the table UI.
- Busted players have explicit `Rebuy` and `Sit Out` actions instead of silent stack resets.

## Architecture

- `apps/web`: Next.js landing page, play lobby, and game table.
- `apps/nakama`: authoritative Nakama runtime module for live multiplayer.
- `packages/engine`: deterministic poker engine and rules.
- `packages/protocol`: shared client/server message contracts.
- `apps/server`: legacy WebSocket backend kept as an optional local fallback.
- `tools/smoke`: multiplayer smoke-test tooling.

The intended production path is Next.js + Nakama + Postgres behind Caddy. The legacy WebSocket server is not the production multiplayer authority.

## Local Development

Prerequisites:

- Node.js 20+
- pnpm 9+
- Docker Desktop or Docker Engine

First run:

```bash
pnpm install
```

On a fresh machine, copy `.env.example` to `.env` and `apps/web/.env.local.example` to `apps/web/.env.local`.

Start the normal local stack:

```bash
pnpm run dev
```

Open `http://localhost:3001`.

Useful local URLs:

- Web: `http://localhost:3001`
- Nakama API: `http://127.0.0.1:7350`
- Nakama console: `http://127.0.0.1:7351`
- Legacy WebSocket fallback: `ws://localhost:3002`

## Common Commands

```bash
pnpm run dev        # Nakama + Postgres + Next.js
pnpm run up         # Start Postgres + Nakama
pnpm run down       # Stop local backend containers
pnpm run logs       # Tail local backend logs
pnpm run dev:web    # Start only the Next.js client
pnpm run dev:legacy # Optional legacy websocket stack
pnpm run test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run test:e2e
```

## Shipping

Use `main` as the clean production branch.

```bash
pnpm ship "Describe the change"
```

`pnpm ship` stages and commits current work when needed, pushes the current branch, merges it into `main` when shipping from a feature branch, pushes `main`, and restarts the production services.

For manual production operations, use `docs/PROD_RUNBOOK.md`.

## Verification

Local quality checks:

```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

Live endpoint checks:

```bash
curl.exe -i https://bondipoker.online/
curl.exe -i https://bondipoker.online/play
curl.exe -i https://play.bondipoker.online/
curl.exe -i https://api.bondipoker.online/healthcheck
```

Remote smoke test:

```bash
SMOKE_SERVER_KEY='<nakama_socket_server_key>' ./scripts/remote-smoke.sh --url https://api.bondipoker.online --ssl true --clients 4
```

## Key Docs

- `docs/LOCAL_DEV.md`: local stack setup and troubleshooting.
- `docs/PROD_RUNBOOK.md`: exact production deployment flow.
- `docs/ENGINE_CONTRACT.md`: poker engine state machine and validation contract.
- `docs/PROTOCOL_CONTRACT.md`: client/server payload contract.
- `docs/DATABASE_MIGRATIONS.md`: migration and seed strategy.
- `docs/INTEGRATION_TESTS.md`: integration test harness.
- `docs/E2E_TESTS.md`: Playwright coverage.
- `docs/TROUBLESHOOTING.md`: production diagnosis and recovery.
- `docs/BACKUP_RESTORE.md`: backup and restore checklist.

## Repo Layout

```text
apps/web          Next.js client, lobby, and table UI
apps/nakama       Authoritative Nakama runtime module
apps/server       Legacy WebSocket backend
packages/engine   Deterministic poker rules engine
packages/protocol Shared protocol types and guards
tools/smoke       Multiplayer smoke tester
```
