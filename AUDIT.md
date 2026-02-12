# Repository Audit

## Runtime / Server
- Nakama runtime language: **TypeScript** (`apps/nakama/src/index.ts`, bundled to `apps/nakama/dist/pdh.js` via esbuild).
- Existing authoritative module: **`pdh`** poker match handler.
- Existing local compose files (before this change):
  - `apps/nakama/docker-compose.yml` (local Postgres + Nakama)
  - `apps/nakama/docker-compose.oracle.yml` (Nakama only; remote DB expected)

## Client SDK Usage
- Web client uses **`@heroiclabs/nakama-js`** (`apps/web/pages/index.tsx`).
- Current auth flow in web app: device auth.
- Current realtime flow: websocket socket -> join authoritative match -> send `ClientMessage` op code `1`, receive `ServerMessage` op code `2`.

## Existing Match Flow (Pre-change)
- Match module: `pdh`.
- Label-based discovery (`{"tableId":"main"}`), plus auto-create hook after device auth.
- Game state handled by `PokerTable` (`@pdh/engine`): seating, betting actions, discard, reconnect, and state snapshots per player.
- Existing tests covered `packages/engine` only; no Nakama runtime unit/integration/smoke harness yet.
