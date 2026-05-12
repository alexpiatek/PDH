# Poker UI Gameplay Audit

## Implementation Note: Active Table UI Refinement

Date: 2026-05-12

Changed in this slice:

- Replaced the roaming latest-action toast with a compact ticker lane under the pot/street stack, hidden during result/history/rules states so it does not cover cards or panels.
- Moved bet-panel close behavior into the expanded panel and kept the primary row to poker actions only. Bet/raise opens at the legal minimum from `legalActions`; all-in confirmation appears only after the all-in preset is chosen, except when all-in is the only legal amount.
- Tightened mobile seat placement with safe viewport clamps, single-line name truncation, and reserved dealer/SB/BB badge space.
- Changed Copy Table Code feedback to inline `Copied` menu feedback with no floating mobile toast or modal.
- Cleaned seat statuses to sentence-case labels such as `Your turn · 28s`, `To act · 25s`, `Waiting`, `Discarding`, `Folded`, `Disconnected`, `Reconnecting`, and `All-in`.
- Kept the discard tray focused on `Discard 1 card`; the helper appears only before a card is selected, and `Discard selected` enables after a valid selection.
- Moved showdown results into a reserved result lane below the table, with mobile wrapping for winner name, amount, hand label, and main/side pot metadata while keeping the next-hand countdown visible.
- Added client-side queued next-hand intent for out-of-chips players. Rebuy next hand and Sit out next hand persist by table/player id, can be changed before applying, and submit only when the existing between-hand/showdown server path allows it.
- Moved table notices into a compact non-overlapping lane below the header; expected early rebuy/sit-out choices now show queued feedback instead of the old between-hand error path.

Remaining active-table UX risks:

- Queued next-hand intent persistence is same-device local state; cross-device recovery would need a small server-backed pending-intent field.
- The result lane is intentionally close to the table but no longer over the felt; future side-pot-heavy results may need an expandable detail view.
- The test route still uses representative snapshots, so live multi-device timing should continue to be smoke-tested after deploy.

## Implementation Note: Active Table UI Cleanup

Date: 2026-05-12

Changed in this slice:

- The active table hamburger menu now exposes player-facing actions only: Hand History, Copy Table Code when a valid table code exists, Rules, and Exit Table.
- Show Extras and Disconnect were removed from the normal player menu. Internal connection cleanup remains in place for unmount and Exit Table behavior.
- Hand history is closed by default and opens as an on-demand panel, preserving the useful street/action formatting without permanently covering the table.
- Rules now open inside the table as a lightweight overlay/sheet using concise "how it works" copy, with no navigation away from the game.
- Copy Table Code appears only for valid 6-character table codes and gives lightweight copied feedback rather than a modal.
- Seat cards now reserve a badge area for dealer/small blind/big blind chips so long names truncate instead of being covered.
- The result banner, discard tray, and last-action toast were moved/simplified to avoid covering the board, hero cards, player cards, and action controls in covered states.

Active-table UX rationale:

- Cards, pot state, player cards, and action controls should remain dominant during a hand.
- Logs, rules, and secondary details are still available, but only on demand.
- Dealer/blind metadata belongs in a reserved part of the player card, not as floating chips over the player name.
- Discard state should be communicated by selected-card highlighting and the action tray, not duplicate floating instruction text.

Remaining active-table UX questions:

- Whether chat/reaction controls should return later as a separate lightweight social panel, distinct from hand history.
- Whether result details need a richer expandable showdown breakdown once multi-way side pots are more common.
- Whether the last-action toast should become timed/animated in live play instead of staying snapshot-visible in tests.

## Implementation Note: Action-First Lobby

Date: 2026-05-12

Changed in this slice:

- The `/play` lobby hierarchy now prioritizes player name, Quick Play, Join by code, and then Recent Tables.
- Mobile now presents compact lobby copy before the play controls instead of a large hero section.
- Recent Tables remains available below the primary actions, but it is visually secondary.
- The desktop lobby keeps the premium two-column Bondi Poker presentation while giving the action column more weight.

Mobile-first rationale:

- Most current lobby use starts with Quick Play, so the player name field and Quick Play CTA need to be visible without scrolling on common mobile portrait viewports.
- Join by code remains immediately available for friend and private games.
- The explanatory hero and feature tiles are supporting material, not the first interaction path.

Remaining lobby UX questions:

- Whether Recent Tables should become collapsed by default once users accumulate many saved tables.
- Whether Quick Play needs clearer feedback about which table it selected after matchmaking.
- Whether private/friend games need a stronger create-table affordance separate from Join by code.

Next suggested audit area: active table / in-hand gameplay UI.

## Implementation Note: Table Entry and Waiting Room

Date: 2026-05-12

Changed in this slice:

- The normal known-name table entry path now uses a compact joining state instead of briefly flashing the full join form.
- The direct table-link fallback keeps a minimal join form and fixes the copy to ask for a player name, not a table name.
- The waiting room now labels the countdown as "Starts in", shows a clear ready count, and keeps seated player chips tied to ready/waiting/reconnecting/disconnected state.
- Mobile waiting-room layout moves the useful card higher, reducing empty atmospheric space above the Ready for Hand action.

Remaining UX questions:

- Whether the waiting room should explain why a disconnected player is still counted during reconnect grace.
- Whether Quick Play tables should show richer table metadata once multiple table types exist.
- Whether ready-state feedback should include a subtle confirmation animation after tapping Ready.

Next suggested audit area: active hand / table gameplay UI.
