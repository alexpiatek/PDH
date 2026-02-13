# Engine Contract (PDH)

This document defines the baseline behavior for `packages/engine` (`PokerTable`) as used by PDH (Discard Hold'em).

## Scope

- Deterministic game state transitions for one table.
- No network/auth/storage logic here.
- Server runtime (Nakama) is responsible for authoritative execution.

## State Model

Primary types are in `packages/engine/src/types.ts`.

- Table state:
  - `id`
  - `config`: blinds + discard timeout
  - `seats`: up to 9 seats (`Seat | null`)
  - `buttonSeat`
  - `hand` (nullable)
  - `log` (public log)
  - `auditLog` / `auditHands` (server-side audit trail)
- Hand state:
  - `street`: `preflop | flop | turn | river | showdown`
  - `phase`: `betting | discard | showdown`
  - `board`: community cards
  - `deck`: undealt cards
  - `players`: per-hand player snapshot (`stack`, `holeCards`, `status`, commitments)
  - betting fields: `currentBet`, `minRaise`, `raisesThisStreet`, `actionOnSeat`, `lastAggressorSeat`
  - discard fields: `discardPending`, `discardDeadline`
  - settlement: `pots`, `showdownWinners`

## PDH Phase Sequence

Nominal sequence (when multiple players remain in hand):

1. `preflop betting`
2. reveal flop -> `flop betting`
3. `flop discard` (every remaining player discards exactly 1)
4. reveal turn -> `turn betting`
5. `turn discard` (every remaining player discards exactly 1)
6. reveal river -> `river betting`
7. `river discard` (every remaining player discards exactly 1)
8. `showdown`

Rules:

- No discards are allowed pre-flop.
- Discards are hidden from other players and removed from `holeCards`.
- Folded/out players are excluded from `discardPending`.
- Players reaching showdown must have exactly 2 hole cards.

All-in short-circuit:

- If betting is locked (all remaining players are all-in or cannot act), betting phases may be skipped.
- Discard obligations still run for remaining players with `holeCards.length > 2`.

## Action Schemas and Validation

From `PokerTable` methods:

- `applyAction(playerId, action)` where action is one of:
  - `fold`
  - `check`
  - `call`
  - `bet { amount }`
  - `raise { amount }`
  - `allIn { amount? }`
- `applyDiscard(playerId, cardIndex)`

Validation guarantees:

- Betting actions only during `phase === betting`.
- Only current `actionOnSeat` may act.
- Illegal actions reject with errors:
  - check while facing bet
  - bet when a bet already exists (must raise)
  - raise below min-raise (except short all-in behavior)
  - raise after raise-cap reached
- Discard only during `phase === discard` and only for `discardPending` players.
- Invalid discard index rejects.

## Determinism Contract

Given:

- identical initial table/seat state
- identical RNG stream passed to `startHand`
- identical ordered action/discard inputs

the resulting state transitions, board cards, winners, and payouts must be identical.

## Showdown Contract

- Hand strength uses best 5-card hand from current 7-card set (`board + remaining hole cards`).
- Side pots are built from `totalCommitted` and resolved by eligibility.
- No rake is applied in engine baseline.

## Authority Boundary

Must remain server-authoritative (never client-authoritative):

- deck construction and shuffle
- dealing, blinds, action order, legal-action checks
- discard enforcement
- street advancement and showdown timing
- side-pot construction and payout distribution
