# Poker UI Gameplay Audit

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
