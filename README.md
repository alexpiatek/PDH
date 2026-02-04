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
- `apps/server`: Node + ws authoritative server (legacy MVP).
- `apps/nakama`: Nakama runtime module + docker-compose.
- `apps/web`: Next.js UI.

## Quick start
```bash
pnpm install
pnpm -C apps/nakama build
docker compose -f apps/nakama/docker-compose.yml up
pnpm dev
```

Nakama runs at `http://localhost:7350` (WebSocket `ws://localhost:7350`).
Override with:
```bash
setx NEXT_PUBLIC_NAKAMA_HOST 127.0.0.1
setx NEXT_PUBLIC_NAKAMA_PORT 7350
setx NEXT_PUBLIC_NAKAMA_USE_SSL false
setx NEXT_PUBLIC_NAKAMA_SERVER_KEY defaultkey
```

## Nakama backend (WIP)
Nakama runtime module scaffold lives in `apps/nakama`.

Build the module:
```bash
pnpm -C apps/nakama build
```

Run Nakama + Postgres:
```bash
docker compose -f apps/nakama/docker-compose.yml up
```

Nakama listens on `http://localhost:7350` (WebSocket `ws://localhost:7350`).
Default server key is `defaultkey`. The Next.js client is not wired to Nakama yet.

## Tests
```bash
pnpm test
```

## Repo layout
```text
apps/server   WebSocket server (authoritative)
apps/nakama   Nakama runtime module + compose
apps/web      Next.js client
packages/engine  Pure poker engine + tests
```

## Notes
- Single table in memory (MVP). Designed for multi-table later.
- Reconnect is playerId-based (store playerId locally).
