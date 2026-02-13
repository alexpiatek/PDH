# Architecture

## Scope

This document describes runtime boundaries and authoritative ownership for PDH in the Nakama deployment path.

## High-Level Boundaries

```text
Browser (Next.js client)
  |
  | HTTPS/WSS
  v
Caddy (TLS termination + host routing)
  |-- play.<domain> -> Next.js :3001
  |-- api.<domain>  -> Nakama  :7350
  v
Nakama (authoritative match runtime, auth/session APIs)
  |
  v
Postgres (Nakama persistence: users, sessions, system storage)
```

Local dev usually skips Caddy and talks directly to Next.js (`:3001`) and Nakama (`:7350`).

## Ownership Matrix

- Client (`apps/web`): UI state, input capture, rendering, optimistic UX only.
- Server (`apps/nakama` + `@pdh/engine`): authoritative game rules and state transitions.
- DB (Postgres): Nakama auth/session/storage persistence. Per-hand table state is in match memory, not written to Postgres by default.
- Proxy (Caddy): TLS, host-based routing, edge exposure control.

## Auth and Session Flow

1. Client creates/persists device id in local storage (`apps/web/pages/play.tsx:52`).
2. Client authenticates via `client.authenticateDevice(..., true)` (`apps/web/pages/play.tsx:527`).
3. Client opens Nakama socket with the authenticated session (`apps/web/pages/play.tsx:530`, `apps/web/pages/play.tsx:551`).
4. Server registers `registerAfterAuthenticateDevice` hook (if available) to ensure default authoritative match exists (`apps/nakama/src/index.ts:18`, `apps/nakama/src/pdhMatch.ts:92`).

## Match Create / Join / Leave Flow

1. Client join strategy (`apps/web/pages/play.tsx:481`):
- explicit `NEXT_PUBLIC_NAKAMA_MATCH_ID` if set;
- else cached match id from local storage;
- else `listMatches` by label `{"tableId":"main"}` and join first result.
2. Server-side default match creation (`apps/nakama/src/pdhMatch.ts:84`) uses label-based dedupe (`apps/nakama/src/pdhMatch.ts:66`).
3. Join attempt currently accepts all (`apps/nakama/src/pdhMatch.ts:119`).
4. On join, presence is tracked and personalized state is sent (`apps/nakama/src/pdhMatch.ts:123`).
5. On leave/disconnect, player is marked sitting out and disconnected in engine (`apps/nakama/src/pdhMatch.ts:139`, `packages/engine/src/table.ts:207`).

## Realtime Protocol and Authoritative State

- OpCode `1` = client messages, `2` = server messages (`apps/nakama/src/pdhMatch.ts:5`, `apps/web/pages/play.tsx:28`).
- Message processing is in Nakama `matchLoop` (`apps/nakama/src/pdhMatch.ts:150`).
- State broadcast is per-presence and personalized (`apps/nakama/src/pdhMatch.ts:34`).
- Hole cards are hidden from other players except owner and contested showdown (`packages/engine/src/table.ts:772`).
- Client sends messages with `socket.sendMatchState(...)` and treats server state as source of truth (`apps/web/pages/play.tsx:567`).

## Determinism and Authoritative Rules

The following MUST remain server-authoritative:

- Deck creation + shuffle (`packages/engine/src/table.ts:158`).
- Blind posting, turn order, action legality, min-raise/raise-cap (`packages/engine/src/table.ts:268`, `packages/engine/src/table.ts:302`).
- Discard enforcement + auto-discard (`packages/engine/src/table.ts:526`, `packages/engine/src/table.ts:553`).
- Street transitions and showdown/pot settlement (`packages/engine/src/table.ts:475`, `packages/engine/src/table.ts:595`, `packages/engine/src/table.ts:646`).

Client-side values (bet amount inputs, local labels, cached match id/device id) are hints only.

## Top 10 Bug Risks and Proposed Tests

1. Risk: betting round stalls if pending phase is never advanced.
Proposed test: Nakama match-loop unit test that completes a betting round, advances clock, and asserts transition `betting -> discard`.
Status: fixed and covered in `apps/nakama/tests/pdhMatch.test.ts:1`.

2. Risk: rejected capped raise still mutates chips/commitments.
Proposed test: engine unit test asserting failed raise-cap action leaves stacks/bets/currentBet unchanged.
Status: fixed and covered in `packages/engine/tests/betting.test.ts:1`.

3. Risk: presence map keyed only by `userId` can conflate multi-device sessions.
Proposed test: Nakama unit test with same `userId` and different `sessionId` presences; one leave must not drop the remaining active connection.

4. Risk: duplicate/replayed client actions (network retries) may apply twice.
Proposed test: send same action payload twice in one tick and across ticks; assert second application is rejected/idempotent with no state drift.

5. Risk: first-user race where match auto-create hook is unavailable or delayed causes join failure.
Proposed test: integration test that authenticates on fresh cluster and validates join success with no pre-existing match.

6. Risk: transient disconnect causes forced fold immediately (no grace window).
Proposed test: disconnect/reconnect timing test to assert intended policy (instant fold vs grace period) explicitly.

7. Risk: stale cached match id in browser local storage can cause repeated join errors.
Proposed test: client integration test with invalid cached match id, assert fallback to list-and-join path succeeds.

8. Risk: wall-clock jumps affect timeout logic (`Date.now`) for pending phase and discard deadlines.
Proposed test: engine + Nakama tests with mocked time jumps forward/backward, verifying monotonic behavior.

9. Risk: concurrent seat claims can race on desired seat.
Proposed test: parallel join messages targeting same seat, assert exactly one success and no duplicate occupancy.

10. Risk: hidden-card privacy regression in personalized state broadcasts.
Proposed test: two-presence broadcast assertion that each player sees own hole cards, opponent cards masked except contested showdown.

