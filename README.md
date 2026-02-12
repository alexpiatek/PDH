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
cp .env.example .env
make dev-up
```

Then run the web app:

```bash
cp apps/web/.env.local.example apps/web/.env.local
pnpm -C apps/web dev
```

Windows: use WSL, or run the equivalent commands from PowerShell/CMD.

## Test + Smoke
```bash
make test
make smoke
```

Smoke test options example:

```bash
./scripts/smoke.sh --host 127.0.0.1 --port 7350 --ssl false --clients 4
```

## Local URLs
- Web app: `http://localhost:3001` (or the Next.js port shown in your terminal)
- Legacy WS server: `ws://localhost:3002`
- Nakama HTTP API: `http://localhost:7350`
- Nakama console API: `http://localhost:7351`

If you use an embedded browser (Cursor/VS Code), open the app URL directly; file previews will not run Next.js.

## Oracle/OCI Run-through
See `docs/DEPLOY_OCI.md` for full OCI deployment steps:
- OCI ingress and host firewall checklist
- production `docker-compose.prod.yml` usage
- TLS reverse proxy (Caddy) example
- console hardening guidance
- remote smoke test verification

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
