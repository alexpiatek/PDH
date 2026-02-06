# PDH - Discard Hold'em (MVP)

Web-based, real-time multiplayer poker variant. Texas Hold'em structure with mandatory discards.

## Rules (MVP)
- Standard 52-card deck, 2-9 players.
- 5 hole cards to each player. No discards pre-flop.
- Flop -> betting -> all remaining players discard exactly 1 card (simultaneous).
- Turn -> betting -> all remaining players discard exactly 1 card (simultaneous).
- River -> betting -> all remaining players discard exactly 1 card (simultaneous).
- After river discard, each player has 2 hole cards.
- Showdown uses any 5 cards from 2 hole + 5 community.
- Discards are face down and never revealed. All-in players still discard.
- No-limit with standard min-raise rules. Short all-in does not reopen betting.
- Odd chip on split pot goes to first winner clockwise from the button.

## Stack
- TypeScript everywhere, pnpm monorepo.
- `packages/engine`: deterministic, pure game logic.
- `apps/server`: Node + ws authoritative server (legacy fallback).
- `apps/nakama`: Nakama authoritative runtime module + docker-compose.
- `apps/web`: Next.js UI (supports both legacy WS and Nakama).

## Quick Start (Nakama Local)
```bash
pnpm install
pnpm -C apps/nakama build
docker compose -f apps/nakama/docker-compose.yml up
cp apps/web/.env.local.example apps/web/.env.local
pnpm -C apps/web dev
```

If you are on Windows without `cp`, copy `apps/web/.env.local.example` to `apps/web/.env.local` manually.

## Local URLs
- Web app: `http://localhost:3001` (or the Next.js port shown in your terminal)
- Legacy WS server: `ws://localhost:3002`
- Nakama HTTP API: `http://localhost:7350`
- Nakama console API: `http://localhost:7351`

If you use an embedded browser (Cursor/VS Code), open the app URL directly; file previews will not run Next.js.

## Oracle/OCI Run-through
Nakama requires PostgreSQL or CockroachDB for its database backend. For Oracle Cloud, run Nakama against a PostgreSQL endpoint hosted in OCI (managed or self-managed).

1. Build the Nakama runtime module:
```bash
pnpm -C apps/nakama build
```
2. Set your remote database DSN:
```bash
export NAKAMA_DATABASE_ADDRESS='nakama:<password>@<postgres-host>:5432/nakama?sslmode=require'
```
3. Start Nakama in Oracle mode (no local Postgres container):
```bash
docker compose -f apps/nakama/docker-compose.oracle.yml up
```
4. Configure the web client to hit your public Nakama host:
```bash
NEXT_PUBLIC_NETWORK_BACKEND=nakama
NEXT_PUBLIC_NAKAMA_HOST=<public-nakama-host>
NEXT_PUBLIC_NAKAMA_PORT=443
NEXT_PUBLIC_NAKAMA_USE_SSL=true
NEXT_PUBLIC_NAKAMA_SERVER_KEY=defaultkey
NEXT_PUBLIC_NAKAMA_MATCH_MODULE=pdh
NEXT_PUBLIC_NAKAMA_TABLE_ID=main
```
5. Deploy the Next.js app and open it from two different browsers/devices to verify shared online play.

The web client auto-discovers a running authoritative match labeled `{"tableId":"main"}` and creates one with module `pdh` if none exists.

## Legacy Quick Start (optional)
```bash
pnpm dev
```

## Card assets (optional)
To use the raster PNG deck (default):
```bash
bash scripts/download-english-pattern-png.sh
```

To use the modern minimal deck:
```bash
bash scripts/download-modern-minimal-cards.sh
```

## Audit log (admin-only)
The server keeps an in-memory audit log for the **last 5 hands** (discarded cards, showdown hole cards, pot size, stacks, winners).  
It is **not** sent to clients and is only accessible via a protected endpoint.

### Enable audit log endpoint
Start the server with a token:
```bash
AUDIT_LOG_TOKEN=supersecret pnpm dev
```

### Fetch locally (when running on your machine)
```bash
AUDIT_LOG_TOKEN=supersecret scripts/fetch-audit-log.sh
```

### Fetch securely from a hosted server
The endpoint is **localhost-only**, so use an SSH tunnel:
```bash
scripts/ssh-audit-tunnel.sh user@your-server 3002 3002
AUDIT_LOG_TOKEN=supersecret scripts/fetch-audit-log.sh
```
## Tests
```bash
pnpm test
```

## Repo layout
```text
apps/server      Legacy WebSocket server
apps/nakama      Nakama runtime module + compose
apps/web         Next.js client
packages/engine  Pure poker engine + tests
```

## Notes
- Single table in memory (MVP), designed for multi-table expansion.
- Reconnect is `playerId`-based and persisted in local storage.
