# Poker Multiplayer Hardening Audit

Date: 2026-05-11

Scope: read-only product, architecture, reliability, and security review for the PDH/BondiPoker repo. This report assumes play-money/social poker. I found no payment, deposit, withdrawal, rake, KYC, AML, or real-money wallet implementation in the inspected code. If the product moves toward real-money gambling, the compliance, security, fairness, responsible-gaming, and audit requirements become a separate critical track.

## Executive Summary

The product is already beyond a toy implementation. The best parts are the shared poker engine, Nakama authoritative match handler, per-player hidden-card state, action validation, duplicate/stale sequence rejection, table-code lobby RPCs, and a serious responsive web table UI. The highest-leverage hardening work is not a rewrite. It is tightening the server state model around timers, reconnects, between-hand flow, state versions, and persistence.

Top current risks:

1. Refreshing, closing, or mobile-backgrounding during a hand immediately marks a player sitting out and folds them through `table.handleDisconnect(...)` in `apps/nakama/src/pdhMatch.ts`.
2. A late player action can still be accepted after `actionDeadline` if it arrives before the match loop runs `autoAction(...)`, because messages are processed before timeout expiry.
3. Next hand advancement is effectively client-driven: any seated player can send `nextHand`, and the web client auto-sends it after 5 seconds.
4. Active hand state is in Nakama match memory only. A server restart loses the hand.
5. State snapshots have no `stateVersion`, `eventSeq`, or server time field, so reconnect/out-of-order debugging depends on convention and full replacement.
6. Presence state is keyed by `userId`, not by session count. Same-user multi-tab/mobile reconnect paths can incorrectly delete the current presence or fold the player.
7. RNG uses server-side `Math.random`. That is acceptable for a casual prototype but not for competitive fairness claims.
8. The repo has both a Nakama path and a legacy WebSocket path. Local `pnpm dev` still uses the legacy path, which can hide Nakama-specific issues during manual testing.

## 1. Repo Orientation

### Main Packages And Apps

| Area | Path | Role |
|---|---|---|
| Web frontend | `apps/web` | Next.js app. Lobby at `/play`, table route at `/table/[matchId]`, gameplay UI in `apps/web/components/PokerGamePage.tsx`. |
| Nakama runtime | `apps/nakama` | Authoritative gameplay match, lobby RPCs, smoke match, built to `apps/nakama/dist/pdh.js`. |
| Legacy WebSocket server | `apps/server` | Local/demo WebSocket server using the same engine but not Nakama. Root `pnpm dev` currently runs this path. |
| Poker engine | `packages/engine` | Table state machine, deck, hand evaluator, betting, discard, showdown, side pots, public state masking. |
| Protocol package | `packages/protocol` | Shared Zod schemas, opcode constants, table code helpers, message types. |
| Integration tools | `tools/integration`, `tools/smoke` | Nakama API integration and smoke tooling. |
| E2E tests | `tests/e2e` | Playwright two-player table tests. |
| Deployment | `docker-compose.prod.yml`, `.github/workflows/*`, `deploy/`, `scripts/` | Nakama/Postgres/Next production deploy and CI paths. |
| Docs | `docs/` | Architecture, protocol, observability, prod runbook, testing notes, UI roadmap. |

### Current Architecture In Plain English

The intended production path is:

```text
Browser / Next.js UI
  -> Nakama auth with device session
  -> Nakama WebSocket
  -> authoritative `pdh` match handler
  -> shared `@pdh/engine` PokerTable
  -> personalized full-state snapshots back to each presence
  -> Postgres for Nakama auth/storage, not active hand state
```

Lobby flow:

- `/play` collects a player name and supports Quick Play, Join by Code, and recent tables.
- `apps/web/lib/nakamaClient.ts` authenticates with Nakama and calls lobby RPCs.
- `apps/nakama/src/pokerLobby.ts` creates/list/joins table codes and stores table metadata in Nakama storage collection `tables`.
- Lobby RPCs create gameplay matches using module `pdh`, not a separate table game engine.

Gameplay flow:

- `/table/[matchId]` renders `PokerGamePage` with a forced Nakama match id.
- The client authenticates a device, opens a Nakama socket, joins the match, then sends a `join` message with name and buy-in.
- `apps/nakama/src/pdhMatch.ts` binds presences, parses client messages, sequences mutating messages, calls `PokerTable`, and broadcasts personalized public state.
- `packages/engine/src/table.ts` owns hand state, blinds, action order, betting validation, discard phase, auto actions, showdown, side pots, stack movement, and hidden-card public state.

The legacy path is:

```text
Browser / Next.js UI
  -> local WebSocket server in `apps/server`
  -> shared `@pdh/engine` PokerTable
```

This is useful for quick local development, but it has weaker identity/reconnect/sequencing semantics than Nakama. It should not be treated as the production authority.

### Main Gameplay Loop

Current implemented loop:

1. Lobby: player enters name, uses Quick Play or table code.
2. Match join: client joins Nakama match and sends `join`.
3. Seat: server seats the user. For Nakama, the server uses `state.tableBuyIn`, not the client-provided buy-in amount.
4. Start gate: first hand waits for at least 2 ready seats. A 30 second countdown opens, or all seated players can ready up.
5. Start hand: engine selects button, shuffles, deals 5 private cards per player, posts blinds, sets preflop actor.
6. Preflop betting: current actor folds/checks/calls/bets/raises/all-ins. Server validates turn and amount.
7. Queued transition: when betting is complete, engine waits about 1.3 seconds before revealing the next phase.
8. Flop: deal 3 community cards, betting round.
9. Flop discard: remaining players with more than 2 hole cards each discard exactly 1 card.
10. Turn: deal 1 community card, betting round.
11. Turn discard: remaining players discard exactly 1 card.
12. River: deal 1 community card, betting round.
13. River discard: remaining players discard exactly 1 card.
14. Showdown: hand evaluator scores best 5-card hands from board plus remaining 2 hole cards, builds side pots, distributes stacks, marks busted seats.
15. Between-hand summary: client displays winner/pot summary and auto-sends `nextHand` after 5 seconds if the local player does not need rebuy.
16. Next hand: server clears the completed hand and immediately starts another hand if at least 2 ready seats remain. There is no server-side between-hand state.
17. Game end/waiting: if fewer than 2 active ready seats remain, `hand` becomes null and no explicit game-over state is created.

### Authority Map

| Concern | Current authority | Notes |
|---|---|---|
| Deck/shuffle/deal | Server/engine | Server-side, but RNG is `Math.random`. |
| Action legality | Server/engine | Strong guard in `PokerTable.applyAction`. |
| Turn order | Server/engine | `actionOnSeat`, `nextToAct`, street reset logic. |
| Timer expiry | Server/engine plus match loop | Deadline exists in state, but loop processes messages before expiry checks. |
| Next-hand timing | Mixed | Server validates complete hand, but client decides when to send `nextHand`. |
| Reconnect policy | Mixed/fragile | Nakama presence events instantly call disconnect/fold logic. |
| Hole-card privacy | Server/engine | `getPublicState(forPlayerId)` masks non-owned cards and deck. |
| Lobby table metadata | Nakama storage | Active hand state is not persisted. |
| Client UI state | Client | Raise drawer, selected discard, local timers, chat mute, reactions. |
| Action dedupe | Server with client seq | Server requires per-player increasing `seq`; client persists local seq. |
| Match listing | Nakama match labels | Gameplay labels are `{"tableId": ...}`. |

## 2. Poker State-Machine Audit

### Current State-Machine Diagram

```text
Lobby
  -> MatchJoined
  -> Seated
  -> WaitingForPlayers
       if readySeats >= 2 and first hand pending:
       -> StartGate(countdown, readyPlayerIds)
            -> Hand(preflop, betting)

Hand(preflop, betting)
  -> PendingBettingAdvance(delay 1300ms)
  -> Hand(flop, betting)
  -> Hand(flop, discard)
  -> Hand(turn, betting)
  -> Hand(turn, discard)
  -> Hand(river, betting)
  -> Hand(river, discard)
  -> Hand(showdown, showdown)

Any betting phase
  -> Showdown if one active player remains
  -> AutoAction on deadline
  -> PlayerFold/Call/Check/Bet/Raise/AllIn if server-valid

Any discard phase
  -> AutoDiscard on discard deadline
  -> Next street when all pending discards are complete

Showdown
  -> Client sends nextHand
  -> Hand cleared
  -> Immediate next hand if readySeats >= 2
  -> WaitingForPlayers if readySeats < 2

Presence leave during hand
  -> set seat sitting out
  -> fold active player immediately
  -> auto-discard if pending discard

Presence reconnect
  -> set seat active
  -> request/sync state
```

### Risky Transitions

| Transition | Risk | Current code |
|---|---|---|
| Connected active player -> leave/disconnect -> folded immediately | Page refresh, app close, mobile background, flaky network all become punitive game actions. | `apps/nakama/src/pdhMatch.ts` `matchLeave`; `packages/engine/src/table.ts` `handleDisconnect`. |
| Deadline reached -> late action message -> accepted | `matchLoop` processes client messages before `autoAction`. There is no deadline check inside `ensureBettingTurn` or `applyAction`. | `apps/nakama/src/pdhMatch.ts` message loop before timer checks; `packages/engine/src/table.ts` `autoAction`. |
| Showdown -> next hand | Any seated player can advance the table; web client auto-sends after 5 seconds. This can cut off winner comprehension for everyone. | `ensureCanAdvanceHand`, `advanceToNextHand`, `PokerGamePage` showdown `setTimeout`. |
| First hand start gate -> subsequent hand immediate start | The first hand has a readiness/countdown model, but later hands do not. | `beginNextHandIfReady`. |
| Same user joins on second session -> old session leaves | Presence keyed by `userId`; old leave can delete the new active presence and fold/mark sitting out. | `state.presences[presence.userId] = presence`; delete by userId in `matchLeave`. |
| Match memory -> server restart | Active hands disappear; table code storage can point to inactive/dead match. | `MatchState.table` in `pdhMatch.ts`; table code storage in `pokerLobby.ts`. |
| State snapshot receipt -> UI state replace | No `stateVersion`; stale or delayed snapshots cannot be rejected client-side. | `PokerGamePage` `setState(msg.state)`. |
| Join after lobby says seats open -> gameplay match full | Gameplay match rejects after join, but lobby presence count is only a coarse pre-check. | `pokerLobby.ts` and `pdhMatch.ts` seat enforcement. |
| Rebuy -> nextHand auto-send | Rebuy confirmation effect can send `nextHand` once stack appears restored. This is convenient but makes between-hand timing depend on a client effect. | `PokerGamePage` rebuy effects. |
| Side-pot showdown -> winner comprehension | Engine calculates pot winners, but UI summary auto-advances quickly and can truncate details on small screens. | `ShowdownResultOverlay`, `showdownSummary`, `SHOWDOWN_AUTO_ADVANCE_MS`. |

### Recommended Canonical State Model

Add explicit canonical table and hand states instead of relying on `hand === null`, `phase`, and client timers:

```ts
type TableStatus =
  | 'empty'
  | 'waiting_for_players'
  | 'start_countdown'
  | 'in_hand'
  | 'between_hands'
  | 'paused'
  | 'closed';

type HandPhase =
  | 'preflop_betting'
  | 'flop_betting'
  | 'flop_discard'
  | 'turn_betting'
  | 'turn_discard'
  | 'river_betting'
  | 'river_discard'
  | 'showdown'
  | 'settled';

type SeatConnectionStatus =
  | 'connected'
  | 'grace'
  | 'disconnected'
  | 'sitting_out'
  | 'busted';
```

Required server fields:

- `tableStateVersion`: monotonically increasing integer for every state mutation.
- `eventSeq`: monotonically increasing integer for event stream/debug logs.
- `serverTimeMs`: included in snapshots so client timers use server time offset.
- `handNumber`: monotonic table-local integer.
- `handId`: stable unique id, preferably `${tableId}-${handNumber}` or UUID, not only `Date.now()`.
- `phaseStartedAtMs`, `phaseDeadlineMs`, `nextTransitionAtMs`.
- `betweenHandEndsAtMs`, `minShowdownVisibleUntilMs`, `readyForNextHandByPlayerId`.
- `seatConnections`: keyed by `userId` with session ids, last seen time, grace deadline, and policy.
- `lastAcceptedActionIdByPlayerId` plus `lastSeqByPlayerId`.

Recommended ownership:

- Only the match handler decides when timeouts, reconnect grace, between-hand windows, and next-hand starts happen.
- Clients can request readiness or actions, but cannot advance a completed hand immediately.
- All snapshots and events carry `stateVersion` so clients can ignore stale state.

### Files/Functions To Refactor, Guard, Or Test

- `apps/nakama/src/pdhMatch.ts`
  - Process expired deadlines before client messages or reject actions when `Date.now() > actionDeadline`.
  - Replace `presences: Record<string, Presence>` with per-user session registry.
  - Add reconnect grace rather than immediate `table.handleDisconnect`.
  - Add server-owned `between_hands` countdown.
  - Add `stateVersion`, `serverTimeMs`, and event ids to snapshots.
  - Persist or checkpoint active match state.
- `packages/engine/src/table.ts`
  - Split table status from hand phase.
  - Add monotonic hand counter/id.
  - Move disconnect policy out of direct immediate fold into an explicit policy method.
  - Add deadline validation hook or action context if timeout remains engine-owned.
- `packages/protocol/src/index.ts`
  - Add strict state schema for hand/public cards instead of `z.any`.
  - Add `actionId`, `stateVersion`, `serverTimeMs`, and typed event messages.
- `apps/nakama/src/protocol.ts`
  - Remove drift from `packages/protocol` or generate/share the same validators in the bundle.
- `apps/web/components/PokerGamePage.tsx`
  - Stop client-owned `nextHand` auto-start.
  - Use server `stateVersion` and server time offset.
  - Split connection, derived table state, action tray, showdown, chat/reactions into focused modules.
- `apps/server/src/index.ts`
  - Either clearly label legacy-only or keep feature parity with sequencing/reconnect if it remains a supported dev path.

## 3. Nakama / Multiplayer Architecture Audit

### What Is Good

- Gameplay is moving in the right direction: `pdhMatch.ts` is the single authoritative mutator in the Nakama path.
- The engine is shared and server-executed; clients send intents, not state.
- Client payloads are parsed and invalid payloads are non-mutating.
- Mutating messages require increasing per-player `seq` values in Nakama.
- The server reserves sequence numbers before rule execution, preventing stale bursts from becoming valid after a turn changes.
- Personalized state broadcasts hide other players' hole cards and never expose the deck.
- Match labels support listing by `tableId`.
- Lobby RPCs store table code metadata and guard full tables at the RPC layer.
- Tests cover malicious buy-in/rebuy payloads, out-of-turn action rejection, duplicate sequences, invalid versions, start gate, auto action, replay debug, and integration reconnect sync.
- Replay ring buffer and structured logs provide a useful debugging base.

### What Is Fragile

- Active hand state is not persisted. Server restart is a table-loss event.
- Presence is keyed by `userId` only. Multi-session handling is not robust.
- `matchJoinAttempt` accepts all users; full-table rejection happens later at `join` message time.
- Reconnect is a state toggle, not a grace policy.
- Timeout evaluation occurs after message handling in each tick.
- Wall-clock `Date.now()` is used throughout timers and ids. Clock jumps can affect deadlines.
- Snapshots have no state version or server timestamp.
- The web client queues pending messages while disconnected. That is convenient, but stale mutating messages need action ids and state-version preconditions to make replay behavior explicit.
- Nakama protocol validation is duplicated manually in `apps/nakama/src/protocol.ts` while the canonical package uses Zod in `packages/protocol/src/index.ts`.
- `packages/engine/src/protocol.ts` appears to be an older protocol artifact and is not the app-facing source of truth.
- `NEXT_PUBLIC_NAKAMA_SERVER_KEY` fallback naming is confusing. For production, only the intended public Nakama client/socket key should ever be exposed in browser env.
- `poker_table` match handler exists as a presence-only lobby table, but current create/quick-play paths create gameplay `pdh` matches. This may be historical code or future scaffolding; document or remove ambiguity.
- Tick rate is 10 Hz. That is fine but higher than poker strictly needs. The bigger issue is deadline semantics, not tick frequency.

### What Should Move Server-Side

- Between-hand summary duration and next-hand auto-start.
- Reconnect grace windows and post-grace policy.
- Action deadline enforcement before message mutation.
- Legal action menu/limits in state snapshots.
- State versioning and event sequencing.
- Durable hand checkpoints or resumable table state.
- Table lifecycle cleanup/recreation when lobby storage points to dead matches.
- Fair RNG source and, if needed, audited shuffle seed/commit metadata.

### What Should Never Be Trusted From The Client

- Buy-in or rebuy amounts.
- Player identity, player id, seat ownership, or reconnect target.
- Current hand id, street, phase, deadline, or turn.
- Deck order, card choices beyond discard index for owned cards, hidden card state.
- Whether an action is legal.
- Raise/bet amount bounds.
- `nextHand` authority.
- Timer expiry or "I was disconnected" claims.
- Chat text without server sanitization/rate limits.
- `seq` as proof of action uniqueness by itself; use server-side `actionId`/idempotency ledger.

### Proposed Nakama Message/Event Contract

Client -> server:

```ts
type ClientEnvelope = {
  v: 2;
  actionId?: string;          // required for mutating intents
  clientSeq?: number;         // monotonic per user/device
  lastSeenStateVersion?: number;
  sentAtMs?: number;
  type:
    | 'join'
    | 'reconnect'
    | 'playerAction'
    | 'discard'
    | 'readyForHand'
    | 'readyForNextHand'
    | 'sitOut'
    | 'rebuy'
    | 'requestState'
    | 'chat'
    | 'reaction';
};
```

Server -> client:

```ts
type ServerEnvelope = {
  v: 2;
  matchId: string;
  tableId: string;
  stateVersion: number;
  eventSeq: number;
  serverTimeMs: number;
  type:
    | 'state.snapshot'
    | 'action.accepted'
    | 'action.rejected'
    | 'timer.started'
    | 'timer.expired'
    | 'hand.started'
    | 'street.changed'
    | 'discard.requested'
    | 'showdown.started'
    | 'pot.awarded'
    | 'between_hand.started'
    | 'player.status_changed'
    | 'presence.changed'
    | 'chat'
    | 'reaction'
    | 'error';
};
```

Snapshot shape should include:

- Public table state.
- Private hero payload separately: own hole cards, legal actions, own timer, pending discard choices.
- `legalActions` computed server-side, including call amount, min raise to, max raise to, all-in availability, raise cap, and reason when unavailable.
- `deadlineMs` and `serverTimeMs`.
- `stateVersion` and `handId`.

This contract lets the UI be simple, lets clients ignore stale states, and gives reliability tooling a stable trace.

## 4. Online Poker UX / Gameplay Best-Practice Audit

### Top UX Issues In Current Implementation

1. Between-hand time is too client-driven and short. Five seconds is often not enough to understand side pots, busted players, and hand labels.
2. Losing connection is treated like a poker action. A refresh or mobile background should not immediately fold a casual player without a grace policy.
3. The first hand has a start gate, but later hands jump immediately once `nextHand` is accepted.
4. Showdown overlay is good, but the summary competes with auto-advance. Users need an explicit "what happened" period.
5. The main table component is very large, which makes it harder to reason about mobile/web consistency and state edge cases.
6. Legal actions are derived client-side from public hand fields. The server should send `legalActions` so web and future mobile render the same controls.
7. Timers are shown from server deadlines but maximum values fall back because `config` is not in the public state. This is fine for defaults but brittle for custom tables.
8. Table status states exist visually, but connection states need to be more poker-specific: reconnecting, grace, auto-fold pending, sitting out next hand.
9. Activity history is parsed from natural-language logs. That is fragile for badges, action history, and localization.
10. Dev UX can diverge from production because `pnpm dev` uses the legacy WebSocket path.

### What Should Be Simplified

- Make the action tray the only action source, and have it render server-sent `legalActions`.
- Replace log-string parsing with typed action events.
- Replace free-form phase inference with a small set of server table states.
- Move "Next Hand" into server `between_hands` readiness.
- Keep chat/reactions in secondary utility areas during critical actions.
- Split `PokerGamePage.tsx` into connection hook, table state selectors, table felt, action tray, showdown recap, and utility panels.

### Persistent Vs Temporary Information

Persistent:

- Hero hole cards, stack, seat status, and current required action.
- Pot amount and current street.
- Board cards.
- Dealer, small blind, big blind markers.
- Current actor and timer.
- Each player's stack, bet committed this street, folded/all-in/disconnected/sitting-out status.
- Last action line.
- Connection/reconnect state.

Temporary:

- Big winner banner.
- Pot distribution breakdown.
- Discard selection confirmation.
- Reactions.
- Chat toasts, if any.
- Action error notices.

Between-hand summary should be persistent for the full between-hand window, not a modal that blocks comprehension. Show:

- Winner(s) and amount(s).
- Winning hand label.
- Best five cards for contested showdown.
- Main pot and side-pot winners.
- Busted/rebuy/sit-out changes.
- Countdown/ready state for next hand.

### Recommended Timer Values

| Timer | Recommended default | Notes |
|---|---:|---|
| Match start first hand | 10-15s, or 3s once everyone ready | Current 30s is safe but slow for Quick Play. Friend tables can keep 15s. |
| Player action | 20s casual, 12-15s fast table | Add visible final 5s urgency. |
| Time bank | 15-30s per player per table session | Spend only after normal timer expires. Optional for MVP but recommended. |
| Disconnect/reconnect grace | 15s desktop, 25-30s mobile-friendly | During grace, show "reconnecting" and do not fold. |
| Discard decision | 12-15s | Current 30s may slow hands. Auto-discard leftmost after deadline is acceptable if visible. |
| Between hands | 6-8s default, 10-12s for contested all-in/side-pot/bust | Server-owned. No client should skip below minimum. |
| Auto-start next hand | After between-hand minimum and either all ready or max 10-12s | Keep "Ready" button to accelerate. |

### Desktop Recommendations

- Keep action tray at bottom with exact labels: Fold, Check, Call N, Bet/Raise N, All-in N.
- Show detailed action history and pot breakdown in a side utility area, not as a blocking modal.
- Make current actor and timer impossible to miss on the seat and action tray.
- Keep side-pot detail available after the overlay closes.

### Mobile Recommendations

- Keep all actions in one pinned bottom tray with safe-area padding.
- Avoid hiding the action buttons behind overlays, chat, or scroll. Add viewport regression tests for 375x667, 390x844, 430x932, and landscape phone.
- Use a compact showdown recap with "Details" expansion, but do not auto-start before the minimum between-hand window.
- Prefer server-sent legal action labels to avoid client/mobile drift.
- Treat mobile backgrounding as expected behavior with reconnect grace.

## 5. Reliability / Failure-Mode Audit

| Failure mode | How it could happen | User impact | Current repo risk level | Where in code to inspect | Recommended fix | Test needed |
|---|---|---|---|---|---|---|
| Refresh page mid-hand | Browser reload closes socket and rejoins | Player is instantly folded/sitting out | High | `pdhMatch.ts` `matchLeave`, `table.ts` `handleDisconnect` | Add reconnect grace and restore same seat if user returns before deadline | Nakama integration: refresh actor page during turn and assert no fold before grace expires |
| Close app and reopen | Mobile/browser app killed | Player may lose hand and sit out | High | Same as above; `PokerGamePage` reconnect | Persist session, grace state, and resume snapshot | Multi-client E2E: close context, reopen `/table/:id`, assert state sync |
| Mobile backgrounding | OS suspends socket | Unintentional fold | High | Presence leave/disconnect policy | Mobile-friendly grace and status overlay | Playwright/mobile browser context background simulation or mocked disconnect |
| Weak network | Delayed send or socket churn | Actions rejected or player folded | Medium/High | `send`, pending queue, `matchLoop` sequence handling | Add action ack, retry idempotently by `actionId`, grace before fold | Network throttling E2E with delayed messages |
| Duplicate socket messages | Retry/double tap/resend | Double action or confusing error | Low/Medium | `reserveSequence`, client `withMutatingSeq` | Keep seq, add action ids and accepted ack | Unit: same action id/seq repeated across ticks |
| Late player action after timer expires | Action arrives after deadline but before `autoAction` runs | Player can act after clock hits zero | High | `pdhMatch.ts` message loop order, `table.autoAction` | Check deadlines before processing actions or process timers first | Unit: set deadline in past, send action, assert rejected/auto-fold |
| Two players acting at same time | Simultaneous messages in same tick | Wrong player rejected, state should stay valid | Low/Medium | `ensureBettingTurn`, engine turn guards | Keep single-writer model, add state-version/action preconditions | Match-loop test with two valid-looking actions in one tick |
| Player disconnects during showdown | Socket closes while results showing | Seat may become sitting out before next hand | Medium | `handleDisconnect`, `markBustedSeats`, `advanceToNextHand` | During showdown/between-hand, mark disconnected but do not mutate past result | Integration: disconnect at showdown and reconnect before next hand |
| Player rejoins between hands | User returns after hand cleared | May be active or sitting out inconsistently | Medium | `setSittingOut`, `reconnect`, `beginNextHandIfReady` | Explicit between-hand readiness and reconnect state | Unit/E2E: leave at showdown, rejoin during between-hand |
| Host/client leaves | No host concept, any player leaves | If active, hand can end abruptly; table may stall with 1 player | Medium | `matchLeave`, `beginNextHandIfReady` | Define no-host casual table lifecycle and empty-table cleanup | Integration: one of two leaves mid-hand and after hand |
| Server restarts | Nakama container restart | Active match/hand lost | High | `MatchState.table` in memory, `docker-compose.prod.yml` | Persist checkpoints to Nakama storage/Postgres or declare restart recovery UX | Restart Nakama mid-hand and assert table recovers or clear user-facing error |
| Database write fails | Lobby table storage write/read failure | Quick Play/code join fails or stale code remains | Medium | `pokerLobby.ts` `writeTableByCode`, `readTableByCode` | Structured error handling, retry, cleanup stale rows | Unit with storageWrite/storageRead throwing |
| Match state not persisted | Normal in-memory match lifecycle | Cannot resume after crash or migration | High | `pdhMatch.ts` `MatchState` | Periodic snapshot on hand boundaries and critical actions | Integration with forced terminate/recreate from snapshot |
| Client receives events out of order | Reconnect, buffering, websocket ordering edge | UI can show stale state | Medium | `PokerGamePage` `setState`, server messages | Add `stateVersion`; client ignores older snapshots | Reducer test: apply state v3 then v2, assert v3 remains |
| Mobile viewport hides action buttons | Small viewport, keyboard, landscape, safe areas | User cannot act before timer expires | Medium/Unknown | `PokerGamePage` layout and pinned tray | Visual regression screenshots and action tray viewport constraints | Playwright screenshots on phone/landscape during betting/discard/showdown |
| Raise amount validation bug | UI min/max mismatch or engine edge case | Illegal bet rejected or wrong all-in | Medium | `PokerGamePage` raise controls, `table.ts` `applyAction/placeRaise` | Server-sent legalActions and property tests | Unit: min raise, short all-in, cap, max stack; client reducer tests |
| All-in / side-pot bug | Staggered commitments and folds | Wrong winner/stack movement | Medium | `buildSidePots`, `scoreShowdown`, tests | Expand property and oracle tests; expose side-pot events | Randomized all-in simulation with chip conservation and pot total checks |
| Hand evaluator mismatch | Custom evaluator differs from accepted poker ranking | Wrong winner | Medium | `handEvaluator.ts` | Cross-check against known evaluator vectors or a reference lib in tests | Golden tests for all categories, kicker tie-breaks, board plays |
| Pot calculation mismatch | UI pot from committed chips differs from settled pots | Users distrust result | Medium | UI `potAmount`, engine `showdownPots` | Server sends current pot and side-pot model during hand | Client state test and engine pot invariant |
| Next-hand starts before users understand previous hand | Client auto-sends `nextHand` at 5s | Confusion, missed win/loss explanation | High | `PokerGamePage` showdown effects, `advanceToNextHand` | Server-owned between-hand state with minimum display time | E2E: showdown remains visible for minimum duration |

## 6. Testing Strategy

### Current Test Coverage

Good existing coverage:

- Engine unit tests cover blinds, betting, raise cap, invalid amounts, side pots, auto-fold timeout, heads-up action, button advance, busted/rebuy/sit-out, discard flow, privacy, showdown, and property tests.
- Protocol tests cover versions, reaction/chat, ready-for-hand, table code helpers, and fractional chip rejection.
- Nakama unit tests cover config validation, malicious join/rebuy amounts, invalid action payloads, max players, start gate, phase tick advancement, out-of-turn rejection, duplicate/stale seq, missing seq, invalid version, replay debugging, auto action, and admin termination.
- Lobby tests cover table creation, join code, full table, missing table, Quick Play selection, convergence after create race, buy-in/skill matching, listing, and max players.
- Integration test covers Nakama authentication, match creation/join, illegal action rejection, preflop-to-flop, disconnect/reconnect sync.
- E2E tests cover two players joining and action turn switching.

Major gaps:

- No explicit late-action-after-deadline race test.
- No multi-session same-user test.
- No reconnect grace because there is no grace model yet.
- No server restart/resume test.
- No state-version/out-of-order client reducer test.
- No mobile viewport regression suite for action tray visibility.
- No load/concurrency test across many tables.
- No external hand-evaluator oracle or large golden vector set.
- No server-sent legal-actions contract tests.

### Recommended Test Backlog

| Priority | Test | Acceptance criteria |
|---|---|---|
| P0 | Timer expiry race in Nakama match loop | If `actionDeadline < now`, an incoming player action is rejected or timeout is applied before mutation. |
| P0 | Reconnect grace unit/integration | Disconnect during own turn enters `grace`, does not fold until `graceDeadlineMs`, reconnect resumes same seat. |
| P0 | Server-owned between-hand state | Showdown enters `between_hands`, ignores `nextHand` until `minShowdownVisibleUntilMs`, auto-starts only by server policy. |
| P0 | Client stale snapshot reducer | State v10 followed by v9 leaves UI at v10 and logs stale snapshot. |
| P0 | Mobile action tray visibility | Betting, discard, rebuy, and showdown controls are visible/clickable at common mobile viewports. |
| P1 | Same user multi-session | Second session can reconnect without old session leave folding/deleting active presence. |
| P1 | Match restart recovery | Restart Nakama mid-hand and assert state restored or table closed with clear UX. |
| P1 | All-in/side-pot randomized simulation | Chip conservation, no negative stacks, pot totals equal commitments, all side pots have eligible winners. |
| P1 | Hand evaluator golden vectors | All hand categories, kicker ties, board plays, wheels, flush/straight interactions pass known expected outcomes. |
| P1 | Legal actions contract | Server snapshot gives legal action labels/amounts matching engine behavior for representative states. |
| P1 | Reconnect during showdown/between-hand | Results remain stable; player status does not corrupt next hand. |
| P2 | Load/concurrency | 50-100 tables with 2-6 clients each can progress actions without deadline drift or memory spikes. |
| P2 | Lobby stale code cleanup | Dead match code returns recoverable UX or recreates table according to policy. |
| P2 | Chat/reaction moderation/rate | Rate limits and message sanitization hold under spam attempts. |

### Test Types To Add

- Unit tests for engine transition invariants and deadline checks.
- Property-based hand simulations with wider all-in, fold, short stack, and side-pot distributions.
- Nakama match handler tests for presence/session registry and timer order.
- Client reducer tests for state versions, acks, and stale errors.
- Playwright mobile layout screenshots.
- Multi-client simulation tests that send concurrent actions, duplicate action ids, reconnects, and network delays.
- E2E happy path from lobby -> table -> hand -> showdown -> next hand.
- E2E nasty paths: refresh actor, background mobile, disconnect at discard, server restart.
- Load tests with many tables and no real browser rendering.

## 7. Security And Fairness Audit

### Serious Risks

- RNG is not competition-grade. `shuffle(deck, rng = Math.random)` is server-side but not cryptographically strong or auditable. For social play, this is medium. For ranked/real-money, this is critical.
- No durable hand audit checkpoint. If a dispute happens after restart, the in-memory replay and audit trail can be gone.
- Reconnect/leave policy is exploitable or punitive. A player can be forced into a fold by connection instability.
- Actions after deadline can be accepted in a small race window.
- Browser env naming can expose `NEXT_PUBLIC_NAKAMA_SERVER_KEY`. Even if this is intended as the public socket key, the name invites future secret leakage.

### Medium Risks

- Protocol validation is duplicated between `packages/protocol` and `apps/nakama/src/protocol.ts`.
- Public state schema is too loose (`hand: z.any`, seats/logs as `any`), so privacy regressions rely on engine tests rather than protocol typing.
- No `stateVersion` or action ack contract. Replay/out-of-order handling is hard to prove.
- Chat text is trimmed and length-limited, but moderation, abuse reporting, and mute semantics are local only.
- `handId` uses `Date.now()`; low collision risk, but weak for audit trails.
- Lobby table code generation uses `Math.random`. Fine for casual codes, but not for anything security-sensitive.
- Legacy WebSocket path has weaker reconnect and no sequence enforcement.

### Recommended Mitigations

- Use crypto RNG server-side for shuffling. In Nakama JS runtime, confirm available crypto APIs; otherwise inject a server-generated secure seed from a trusted source.
- Store per-hand audit checkpoints at hand start, each accepted action, street transition, and settlement, at least for recent active hands.
- Add action ids and idempotency ledger.
- Add server state versions, event sequence, and server time.
- Move timeout enforcement before action mutation.
- Add reconnect grace with clear player status.
- Strictly type public state and private hero state.
- Rename env vars to distinguish public Nakama socket key from runtime/admin secrets.
- Treat real-money readiness as a separate security/compliance program: KYC/age gates, jurisdiction blocking, responsible gaming controls, anti-collusion, bot detection, rake accounting, wallet ledger, audit logs, regulator-grade RNG certification, and incident response.

### Files/Functions To Review

- RNG/shuffle: `packages/engine/src/deck.ts`, `packages/engine/src/table.ts`.
- Hidden cards/public state: `packages/engine/src/table.ts` `getPublicState`, `packages/engine/tests/privacy.test.ts`.
- Action validation: `packages/engine/src/table.ts` `applyAction`, `placeRaise`, `buildSidePots`, `scoreShowdown`.
- Network validation: `apps/nakama/src/protocol.ts`, `packages/protocol/src/index.ts`.
- Match security: `apps/nakama/src/pdhMatch.ts`.
- Client secrets/envs: `apps/web/components/PokerGamePage.tsx`, `apps/web/lib/nakamaClient.ts`, deployment env docs.
- Legacy path: `apps/server/src/index.ts`.

## 8. Observability And Debugging

The repo already has a good start in `docs/observability.md` and `pdhMatch.ts` structured logs. The next step is to make logs state-versioned and action-id based.

### Server-Side Logs To Add/Keep

Log these as structured server events:

- `matchId`
- `tableId`
- `handId`
- `handNumber`
- `stateVersion`
- `eventSeq`
- `tick`
- `serverTimeMs`
- `playerId`
- `sessionId` where relevant
- `actionId`
- `clientSeq`
- `lastSeenStateVersion`
- `action.type`
- `amount`
- `streetBefore`, `phaseBefore`, `streetAfter`, `phaseAfter`
- `timer.started`, `timer.expiresAtMs`, `timer.expired`
- `reconnect.grace_started`, `reconnect.resumed`, `reconnect.grace_expired`
- `presence.join`, `presence.leave`
- `invalid_action.reason`
- `pot.changed`
- `showdown.pot_awarded`
- `winner.playerId`, `winner.amount`, `winner.handLabel`
- `state.persisted`, `state.persist_failed`

### Client-Side Logs To Add/Keep

Log bounded client events:

- connection start/success/error/disconnect/reconnect
- joined match id/table id
- received state version
- ignored stale state version
- action clicked with action id/type, not hidden cards
- action accepted/rejected
- timer visual drift if server time offset changes materially
- viewport/action tray visibility diagnostics in test builds

### Never Log

- Auth tokens, refresh tokens, cookies, Nakama runtime/admin keys.
- Full raw payloads from clients.
- Deck order.
- Non-owner hole cards in public logs.
- Private player cards in broad production logs.
- Unbounded chat text or PII beyond operationally required identifiers.

Server audit logs may need hidden-card data for disputes, but that should be restricted, short-retention, access-controlled, and never sent to clients.

## 9. Product Roadmap

### Phase 0: Critical Fixes Before Wider Testing

Goal: prevent the most frustrating and trust-damaging multiplayer failures.

Why it matters: users will forgive rough visuals faster than accidental folds, late actions, or missed showdown results.

Tickets, order, and acceptance:

1. Fix timer expiry order. Complexity: M.
   Acceptance: actions after `actionDeadline` cannot mutate state; test covers same-tick race.
2. Add server-owned between-hand state. Complexity: L.
   Acceptance: showdown remains visible for minimum duration and next hand starts by server policy.
3. Add reconnect grace. Complexity: L.
   Acceptance: refresh/mobile background within grace does not fold player.
4. Add `stateVersion` and `serverTimeMs` to snapshots. Complexity: M.
   Acceptance: client ignores stale state and timers use server time offset.
5. Make local dev default able to run Nakama path easily. Complexity: S.
   Acceptance: documented `pnpm dev:nakama` or default local script exercises production path.

### Phase 1: Robust Casual Multiplayer

Goal: make normal social play reliable across browser refreshes, weak networks, and table churn.

Why it matters: this is the baseline for friends playing multiple hands without operator intervention.

Tickets:

- Session-aware presence registry.
- Idempotent `actionId` and action ack contract.
- Server-sent `legalActions`.
- Typed event log for action history.
- Stale table-code recovery.
- Table empty cleanup policy.

Acceptance:

- Multi-client integration covers duplicate actions, reconnect during turn, reconnect during discard, and rejoin between hands.
- UI renders legal controls from server state.
- Table codes either resolve or return a clear recoverable error.

Complexity: L.

### Phase 2: Strong Mobile/Web Polish

Goal: make mobile and desktop feel like the same product with viewport-appropriate controls.

Why it matters: poker decisions are time-bound. Hidden controls or ambiguous labels directly cause bad hands.

Tickets:

- Split `PokerGamePage.tsx` into focused components and hooks.
- Add mobile visual regression suite.
- Compact between-hand recap for phone.
- Persistent player status badges: thinking, folded, all-in, disconnected, grace, sitting out, winner, dealer, SB, BB.
- Better action history from typed events.

Acceptance:

- Action tray is visible and clickable on target mobile viewports.
- No `Call 0`; check/call labels always exact.
- Showdown recap visible for minimum time on mobile and desktop.

Complexity: L.

### Phase 3: Competitive/Fairness Hardening

Goal: make fairness claims defensible for ranked or serious play-money games.

Why it matters: players need to trust shuffle, hidden cards, action validation, and settlement.

Tickets:

- Crypto RNG for deck shuffle.
- Hand audit checkpoints.
- External/golden evaluator test vectors.
- Expanded side-pot/all-in property tests.
- Strict private/public state schemas.
- Anti-abuse basics: rate limits, chat moderation hooks, suspicious action telemetry.

Acceptance:

- Shuffle source documented and tested.
- Hidden card privacy has protocol-level tests.
- Settlement has deterministic replay from audit inputs.

Complexity: XL.

### Phase 4: Scale/Testing/Observability

Goal: operate many tables and debug live incidents quickly.

Why it matters: reliability issues become hard to reproduce once many users are involved.

Tickets:

- Match state persistence/checkpointing.
- Load simulation across many tables.
- Dashboard metrics for active tables, hands/hour, rejected actions, disconnects, timer expiries, reconnect success.
- Replay viewer tooling using action ids/state versions.
- Alert thresholds for Nakama health, error rates, stuck hands, and DB failures.

Acceptance:

- Load test can run 50-100 tables with stable progression.
- Any hand can be debugged by match id + hand id + action id.
- Stuck hand alert has a runbook.

Complexity: XL.

### Phase 5: Optional Tournament/Ranked/Real-Money-Readiness Considerations

Goal: define what changes if the product becomes competitive, ranked, or real-money.

Why it matters: real-money poker is a different compliance and security product.

Tickets:

- Tournament state model: registration, seating, blinds schedule, breaks, eliminations, payouts.
- Ranked matchmaking and ratings.
- Anti-collusion and bot detection.
- Responsible gaming controls.
- Wallet/ledger only if real-money is explicitly pursued.
- KYC/AML/age/jurisdiction checks only if real-money is explicitly pursued.
- Regulator-grade RNG and immutable audit logs.

Acceptance:

- Product decision document explicitly states social/play-money vs ranked vs real-money.
- No real-money work begins without compliance/security architecture review.

Complexity: XL.

## Top 10 Next Codex Tasks

### 1. Fix Late-Action Timer Race

Why it matters: a player should not be able to act after the server deadline.

Files likely involved: `apps/nakama/src/pdhMatch.ts`, `packages/engine/src/table.ts`, `apps/nakama/tests/pdhMatch.test.ts`.

Acceptance criteria:

- Match loop rejects or auto-resolves an action when `now > actionDeadline`.
- Unit test sets `actionDeadline` in the past and sends an otherwise valid action.
- Existing duplicate/out-of-turn tests still pass.

Suggested Codex model setting: High.

### 2. Add Server-Owned Between-Hand State

Why it matters: showdown results need guaranteed comprehension time, and next hand should not depend on one client timer.

Files likely involved: `packages/engine/src/types.ts`, `packages/engine/src/table.ts`, `packages/protocol/src/index.ts`, `apps/nakama/src/pdhMatch.ts`, `apps/web/components/PokerGamePage.tsx`, tests.

Acceptance criteria:

- Showdown transitions to `between_hands` or equivalent server state.
- `nextHand` before minimum reveal window is rejected or treated as readiness only.
- Server auto-starts after configured window when enough players remain.
- E2E verifies showdown remains visible for the minimum time.

Suggested Codex model setting: Extra High.

### 3. Implement Reconnect Grace

Why it matters: refresh/mobile background should not instantly fold a casual player.

Files likely involved: `apps/nakama/src/pdhMatch.ts`, `packages/engine/src/table.ts`, `packages/engine/src/types.ts`, `apps/web/components/PokerGamePage.tsx`, integration tests.

Acceptance criteria:

- Leave during a hand marks `grace` with a deadline.
- Rejoin before grace resumes the same seat and hand.
- Grace expiry applies the table policy: auto-check/fold/sit-out as configured.
- Tests cover actor disconnect and non-actor disconnect.

Suggested Codex model setting: Extra High.

### 4. Add State Version And Server Time

Why it matters: clients need deterministic stale-state handling and timer display aligned to server time.

Files likely involved: `apps/nakama/src/pdhMatch.ts`, `packages/protocol/src/index.ts`, `apps/nakama/src/protocol.ts`, `apps/web/components/PokerGamePage.tsx`.

Acceptance criteria:

- Every state mutation increments `stateVersion`.
- Snapshots include `stateVersion` and `serverTimeMs`.
- Client ignores snapshots older than the last applied version.
- Unit tests cover stale snapshot behavior.

Suggested Codex model setting: High.

### 5. Replace Client-Derived Legal Actions With Server LegalActions

Why it matters: web and mobile should render exactly what the server will accept.

Files likely involved: `packages/engine/src/table.ts`, `packages/protocol/src/index.ts`, `apps/nakama/src/pdhMatch.ts`, `apps/web/components/PokerGamePage.tsx`.

Acceptance criteria:

- Public/private state includes legal action options for the current player.
- UI action tray uses server labels/amount bounds.
- Engine tests cover legal action output for call/check/raise/all-in/cap cases.

Suggested Codex model setting: Extra High.

### 6. Add Session-Aware Presence Registry

Why it matters: multi-tab or mobile reconnect should not let an old session leave delete the active one.

Files likely involved: `apps/nakama/src/pdhMatch.ts`, `apps/nakama/tests/pdhMatch.test.ts`, integration tests.

Acceptance criteria:

- Presence state tracks sessions per user.
- Leaving one session only disconnects the player when no active sessions remain.
- Tests cover same `userId`, two `sessionId`s, old session leaving after new session joined.

Suggested Codex model setting: High.

### 7. Tighten Protocol Source Of Truth

Why it matters: drift between manual Nakama validators and Zod package schemas can create production-only bugs.

Files likely involved: `packages/protocol/src/index.ts`, `apps/nakama/src/protocol.ts`, `packages/engine/src/protocol.ts`, tests.

Acceptance criteria:

- One canonical message contract is documented and tested.
- Dead/legacy protocol file is removed or clearly deprecated.
- Nakama parser tests mirror package parser tests.

Suggested Codex model setting: Medium.

## Implementation Note: Reliability Hardening Slice 1

Date: 2026-05-11

Fixed in this slice:

- The Nakama authoritative match loop now applies expired start gates, queued street advances, betting auto-actions, and discard auto-discard before processing client messages. A betting action or discard that arrives after its server deadline is handled after the server timeout mutation, so the late client message cannot be the mutation that advances the hand.
- Nakama match state now carries a monotonic `stateVersion`. Authoritative state snapshots include `stateVersion` and `serverTimeMs`.
- The web table client tracks the latest applied `stateVersion` and ignores stale or duplicate versioned snapshots. Legacy/local snapshots without `stateVersion` are still accepted for compatibility.

Intentionally not fixed yet:

- No reconnect grace/session registry changes.
- No between-hand ownership refactor.
- No server-owned `legalActions` contract.
- No active-hand persistence/checkpointing.

Next recommended task: implement session-aware reconnect grace in the Nakama presence path so transient refreshes and same-user multi-session joins do not immediately fold or sit out an active player.

## Implementation Note: Reliability Hardening Slice 2

Date: 2026-05-11

Fixed in this slice:

- Nakama authoritative match presence is now session-aware: active presences are keyed by `userId` plus `sessionId`, so leaving one tab/session does not disconnect the player while another session remains.
- Seated players with no active sessions enter reconnect grace instead of immediately calling the engine disconnect policy.
- Reconnecting during grace restores connected status, keeps the same seat, and preserves the current hand.
- When grace expires, the match layer applies the existing disconnect policy deterministically. If the expired player is on action, the server first applies the existing auto-action timeout behavior.
- Public snapshots expose minimal per-player connection status so the web table can show a compact reconnecting/disconnected label without redesigning the table.

Default reconnect grace duration: 15 seconds.

Remaining limitations:

- Reconnect grace is still in-memory with the authoritative match; active hand persistence remains unfixed.
- Between-hand advancement is still client-driven.
- Legal action options are still derived by the client rather than server-owned.

Next recommended task: implement server-owned between-hand state so showdown visibility and next-hand advancement are authoritative instead of client-timed.

### 8. Add Mobile Action-Tray Regression Tests

Why it matters: hidden action buttons are a direct gameplay failure on timed turns.

Files likely involved: `tests/e2e/play-flow.spec.ts`, `playwright.config.ts`, `apps/web/components/PokerGamePage.tsx`.

Acceptance criteria:

- Tests cover betting, discard, showdown, and rebuy trays at phone portrait and landscape sizes.
- Screenshots or locator checks prove primary actions are visible and enabled when expected.
- No text/button overlap on target viewports.

Suggested Codex model setting: High.

### 9. Add Persistent Hand Checkpoint Skeleton

Why it matters: server restarts should not silently destroy active tables.

Files likely involved: `apps/nakama/src/pdhMatch.ts`, `apps/nakama/src/nakama-runtime.d.ts`, `docs/observability.md`, integration tests.

Acceptance criteria:

- Hand checkpoint shape is defined.
- State writes on hand start, accepted action, street transition, and settlement.
- Failure to persist logs a structured error and does not expose secrets.
- A recovery policy is documented even if full restore is phased.

Suggested Codex model setting: Extra High.

### 10. Add Hand Evaluator Golden Vectors

Why it matters: custom evaluators need broad known-answer coverage before fairness claims.

Files likely involved: `packages/engine/tests/evaluation.test.ts`, `packages/engine/src/handEvaluator.ts`.

Acceptance criteria:

- Tests cover all categories, wheel straight, straight flush, flush-vs-straight, full-house tie-breaks, kicker ties, board-play split pots.
- Any evaluator change must pass known vectors and existing property tests.

Suggested Codex model setting: Medium.

## Implementation Note: Reliability Hardening Slice 3

Date: 2026-05-11

Fixed in this slice:

- Nakama authoritative matches now enter an explicit server-owned between-hand state when a settled hand reaches showdown.
- Between-hand snapshots expose `betweenHandStartedAtMs`, `betweenHandMinUntilMs`, `betweenHandAutoStartAtMs`, and `readyForNextHandPlayerIds`. Clients continue to use `serverTimeMs` for countdown display.
- The web table no longer auto-sends `nextHand` from a local showdown timer. It shows the server countdown and lets the seated player mark ready.
- Legacy `nextHand` messages are preserved as compatibility input, but Nakama now interprets them as ready-for-next-hand signals rather than immediate authority.

Default between-hand timings:

- Minimum result display: 6 seconds.
- Maximum auto-start delay: 12 seconds.

Remaining risks:

- Between-hand state is still in match memory only; restart recovery is not implemented.
- Legal action options are still client-derived.
- The legacy WebSocket dev path does not have the same server-owned between-hand policy as the Nakama authoritative path.

Next recommended task: server-sent `legalActions`.

## Implementation Note: Reliability Hardening Slice 4

Date: 2026-05-11

Fixed in this slice:

- The engine now computes deterministic per-player `legalActions` from authoritative table state.
- Nakama authoritative snapshots now include personalized `legalActions` for the receiving player.
- The web table action tray prefers Nakama `legalActions` for betting controls, call/check labels, raise/bet bounds, all-in affordances, and discard card validity.

`legalActions` now covers:

- Betting turn ownership, fold/check/call/bet/raise/all-in availability, call amount, bet and raise-to bounds, stack, street commitment, and current bet.
- Discard turn ownership, required discard count, valid card indexes, and discard deadline when available.
- Waiting, showdown, between-hand, folded, busted, disconnected, sitting-out, all-in, and non-actor states with no betting controls exposed.

Legacy fallback behavior:

- The legacy/local web path keeps the existing public-state derivation when `legalActions` is missing.
- In Nakama mode, a received `legalActions` object is treated as authoritative for the action tray, even when it intentionally contains no betting actions.

Remaining risks:

- `legalActions` is UI guidance only; server validation remains the final authority for every submitted action.
- Active hand persistence/restart recovery is still not implemented.
- Mobile-specific action-tray regression coverage is still thin.

Next recommended task: add mobile action-tray regression tests, or move to persistence/restart recovery if restart safety is the higher priority.

## Implementation Note: Mobile Action-Tray Regression Coverage

Date: 2026-05-11

Covered in this slice:

- Added state-driven Playwright coverage for the action tray at 390x844 mobile portrait, 375x667 small mobile, 844x390 mobile landscape, and 1280x720 desktop.
- Covered betting controls from Nakama-style `legalActions`, including call/raise, check/all-in, no `Call 0`, raise drawer access, and primary action clickability.
- Covered discard selection plus the confirm discard CTA, and showdown/between-hand visibility with the server-owned next-hand countdown/ready state.

Layout fixes made:

- Added safe-area-aware bottom positioning to the between-hand countdown.
- Tightened mobile-landscape betting tray padding and table vertical reserve so the action tray container stays inside the viewport.
- Added semantic test ids for the action tray and raise drawer controls without changing `legalActions` resolution or legacy fallback behavior.

Remaining UI risks:

- The regression page uses representative snapshots rather than a full live Nakama hand progression, so it does not prove transport, reconnect, or timing behavior.
- Visual overlap is checked through locator visibility, viewport bounds, and clickability rather than screenshot diffing.

Next recommended task: implement active hand persistence/restart recovery.

## Implementation Note: Restart Checkpoint Foundation

Date: 2026-05-12

Covered in this slice:

- Nakama authoritative poker matches now write bounded server-side checkpoints to Nakama storage collection `pdh_match_checkpoints`, keyed by table id under the system user id.
- Checkpoints include `schemaVersion`, `tableId`, `matchId`, `stateVersion`, `eventSeq`, `serverTimeMs`, `writtenAtMs`, `expiresAtMs`, `handId`, `handNumber`, `phase`, `street`, table config metadata, seat summaries, connection/grace state, between-hand metadata, a bounded replay/action log, and a private server-only `TableState` snapshot.
- Checkpoints are written on match init/restore, presence join/leave, player seat/join, hand start, accepted player action, discard, auto action/discard, street/phase transition, showdown settlement, between-hand start/readiness, next-hand start, rebuy, sit-out, and reconnect grace changes.
- Checkpoint write failures are structured-log errors and do not crash normal gameplay. The failure log includes ids/reason/version only, not the private table snapshot.

Recovery policy:

- Option A restore is now the first policy. On match init/table recreation, the match reads a recent checkpoint and rehydrates the authoritative `PokerTable` state from the private server-side snapshot.
- Restored matches continue from a higher `stateVersion`, start with empty live presences, and mark seated players that were not already disconnected as reconnecting for the configured reconnect grace window.
- If lobby metadata points to a dead match but a recent checkpoint exists, join-by-code creates a replacement authoritative match for the same table id and updates the stored lobby match id. Clients still receive only the replacement match id/status, not checkpoint contents.
- Hidden hole cards and deck state are stored only in the server-side checkpoint object with storage read/write permissions set to server-only. Client recovery/status messages continue to use the existing masked personalized snapshots.

Still not solved:

- This is not a ledger, compliance archive, or hand-history audit system.
- Checkpoints are latest-state snapshots, not a transaction log with replayable causality guarantees.
- Cross-node concurrent restoration and storage compare-and-swap/version conflict handling are not implemented.
- Old checkpoints are ignored after the recovery window rather than migrated into a long-term interrupted-table workflow.

Next recommended task: add storage-version conflict handling plus an interrupted-table user flow for stale checkpoints that are too old or invalid to restore.
