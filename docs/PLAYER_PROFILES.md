# Free group pilot: player profiles

## Player experience
Email and password are required before playing. New accounts receive 10,000 free play chips once. The profile offers unlimited additions of exactly 10,000 chips. Chips have no cash value; there are no purchases, withdrawals, payment gateways or charges. Sign in with the same account on another device to retain the balance and history.

Available chips are separate from chips reserved at a table. Taking a seat transfers a buy-in to that table; subsequent table rebuys are counted separately from account top-ups. Winnings and losses update the saved table stack after settlement. Leaving waits for reconnect grace and any current hand to resolve before returning the reserved stack. The pilot allows one funded table per account.

The profile reports table sessions (taking a funded seat), hands started/completed/won, net chips won or lost, table rebuys, free top-ups, and total free chips granted. A split-pot recipient counts as a hand won. These are prospective statistics, not reconstructed history. Top-ups never count as winnings.

## Storage and integrity
Use the existing Nakama email authentication and PostgreSQL storage. Profiles, ledger entries and table checkpoints commit together with version checks. Failed writes do not publish changed game state. Each free top-up has a unique receipt; replaying it returns the current balance without granting again. Profile and ledger writes are server-only. The operator directory is private.

Collections: `pdh_player_profiles`, `pdh_chip_ledger`, `pdh_player_directory`; existing `pdh_match_checkpoints` remain authoritative for gameplay. Back up all of them together with the account database. Do not clear or edit individual balances/checkpoints to repair a live table. Inspect the ledger and reconcile first.

Private tables are code-access tables: anyone with a shared code can join. They are hidden from listings and a raw match ID does not bypass admission. This is not owner-approved membership. Run a single Nakama node for this pilot; distributed concurrent table recovery remains outside the validated deployment scope.

## Rollout checklist
1. Review and merge the branch only after CI succeeds. Rehearse the deployment and rollback on staging first, including the initial upgrade from a release without a tracked lockfile. Configure the deployment user's service permissions for both stop and restart. Protect main and the GitHub production environment.
2. Back up PostgreSQL and verify a restore. Drain existing guest tables. Preserve their checkpoints and balances as an archive; do not enable accounting over occupied legacy tables. An existing guest account is not automatically linked to a newly created email account. Agree any guest-to-account migration with players before changing historical data.
3. Set `PDH_ENABLE_PLAYER_PROFILES=true` in the Nakama environment and `NEXT_PUBLIC_PLAYER_PROFILES=true` in the web build environment. Production compose requires an explicit choice so an old database is not silently switched. The public web flag defaults on; `false` is only for legacy diagnostics and fixture tests, and must match the server mode.
4. Create Alex and Brad's email accounts. Set their actual Nakama user IDs in the comma-separated `PDH_ADMIN_USER_IDS` runtime environment. `/players` provides the restricted, paginated player report. Do not use email addresses or usernames in this list.
5. Configure HTTPS/WSS, unique server/session keys and private database/console access. Keep production secrets out of Git. The server session lifetime is two hours, refresh lifetime thirty days; account sign-in after a server restart remains supported.
6. Run a two-player rehearsal, then a phone-heavy group session: signup, code invitation, every discard street, all-in/side pots, reconnect, leave/refund, re-entry and free top-up. Compare operator totals with player balances and collect feedback.

## Remaining operational limits
Email delivery, verified email ownership and self-service password recovery are not implemented. For a closed pilot, explain this at onboarding and provide an operator support route; do not claim email verification. These are required follow-up work before broad public registration. Unlimited free grants intentionally make balances unsuitable for competitive rankings based on total chips; use net results and hands played instead.

The new deployment workflow waits for all CI jobs and activates the exact tested SHA. It builds in a separate worktree and retains prior artifacts, with an automatic best-effort rollback on activation failure. Database contents are not rolled back. Older manual deployment scripts are maintenance tools and bypass CI; do not use them for normal releases. `pnpm ship` now waits for the GitHub deployment workflow rather than deploying immediately.

## References
- Nakama authentication: https://heroiclabs.com/docs/nakama/concepts/authentication/
- JavaScript client: https://heroiclabs.com/docs/nakama/client-libraries/javascript/
- Storage API: https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/function-reference/

Behavior is tested against the repository's pinned Nakama 3.17.0 image, rather than assuming current documentation exactly matches it.
