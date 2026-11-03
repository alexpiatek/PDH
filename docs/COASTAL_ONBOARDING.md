# Coastal first-play flow

The homepage, lobby, account entry and local practice hand share the dark coastal palette and existing Bondi brand mark. The minimal live deck is shared with these screens through `MinimalCardFace`, preserving the existing pips and court-card artwork with a subtle surf detail. Community destinations use the existing Discord environment override and Bondi Poker X account.

## Entry points

- `/practice` is a fixed, local teaching hand. It skips betting explicitly, lets the visitor choose one hidden discard after each completed post-flop betting round, and uses the real engine to score the final two cards plus five community cards. Restart restores the starting hand. It never authenticates, joins Nakama, or changes chip balances.
- `/play?action=create` and `/play?action=quick` retain a specific action through the existing account gate. `/play?code=RZ587G` retains an invitation. Only known actions and validated six-character codes are accepted; arbitrary return URLs are ignored.
- After account entry succeeds, the lobby reads the profile name and resumes the chosen action once. A failed table request leaves the visible form available for an explicit retry.
- `/play` remains a browsable lobby with create-table and join-code controls. Public Quick Play is available in the secondary disclosure. Recent tables appear only when there is history.
- A solo waiting host sees the actual seat count, code and an origin-relative invitation URL. Clipboard success is reported only after the browser confirms the write; unavailable clipboard access shows manual-copy guidance. Practice opens in another tab so the waiting session remains open.

## Validation and release

Run the repository lint, typecheck, unit tests, production web build, and CI integration/E2E jobs. The E2E suite covers the local practice path, responsive friend-first lobby, solo-host invitation, and existing real two-player flow. `solo-waiting` is an additional snapshot in the existing test-only route; the route remains unavailable unless `PDH_ENABLE_TEST_POKER_STATE=1` is explicitly set.

Deploy only after reviewing the visual evidence and passing server-backed CI. This is a frontend-only change with no database, Nakama runtime, protocol, player account, campaign or chip-ledger migration. Use the existing tested deployment workflow. Roll back by restoring the prior web release; no data rollback is required. Domain/DNS changes are separate from this code change.
