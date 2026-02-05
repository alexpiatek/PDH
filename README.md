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
- `apps/server`: Node + ws authoritative server.
- `apps/web`: Next.js UI.

## Quick start
```bash
pnpm install
pnpm dev
```

## Card assets (optional)
To use the raster PNG deck (default), run:
```bash
bash scripts/download-english-pattern-png.sh
```

To use the modern minimal deck, run:
```bash
bash scripts/download-modern-minimal-cards.sh
```

Server runs at `ws://localhost:3002`. The web app runs at `http://localhost:3001` and defaults to that URL.
If you use an embedded browser (like Cursor/VS Code), open `http://localhost:3001` directly; file previews won’t work with Next.js.
Override with:
```bash
setx NEXT_PUBLIC_WS_URL ws://localhost:3002
```

## Tests
```bash
pnpm test
```

## Repo layout
```text
apps/server   WebSocket server (authoritative)
apps/web      Next.js client
packages/engine  Pure poker engine + tests
```

## Notes
- Single table in memory (MVP). Designed for multi-table later.
- Reconnect is playerId-based (store playerId locally).
