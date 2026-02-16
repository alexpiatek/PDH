# BondiPoker UI/UX Redesign Roadmap

## Vision
Make BondiPoker feel as frictionless as a modern social app and as satisfying as a premium game, while preserving authoritative fairness.

Design direction: Neo-Luxury Minimal (dark calm surfaces, one bold accent, sparse glow, high readability).

## Product Outcomes
Primary outcomes:
- Reduce time-to-first-hand (landing to seated in active hand).
- Improve in-hand decision clarity under pressure.
- Increase session stickiness through social loops.
- Make discard interaction a recognizable product signature.

Target metrics for v1 rollout:
- `time_to_first_hand_p50` <= 45s.
- `time_to_first_hand_p90` <= 90s.
- `quick_play_success_rate` >= 98%.
- `discard_input_latency_p95` <= 120ms.
- `day1_return_rate` +10% vs current baseline.

## Current Baseline (Code)
Frontend:
- Landing: `apps/web/pages/index.tsx`, `apps/web/components/HeroSection.tsx`.
- Lobby: `apps/web/pages/play.tsx`.
- Table/game: `apps/web/components/PokerGamePage.tsx` (single large component, inline styling).
- Global styling: `apps/web/styles/globals.css`.

Backend:
- Lobby RPCs today: create table + join by code only.
  - `apps/nakama/src/pokerLobby.ts` (`rpcCreateTable`, `rpcJoinByCode`).
- Runtime registration: `apps/nakama/src/index.ts`.
- Authoritative gameplay already enforced in `apps/nakama/src/pdhMatch.ts`.

## Delivery Strategy
Deliver in gated phases so we can ship improvements without destabilizing core gameplay.

Suggested feature flags (DB-backed, with env fallback):
- `ui.neo_luxury_theme`
- `ui.quick_play`
- `ui.table_v2`
- `ui.discard_overlay_v2`
- `social.friends_lobby`
- `progression.missions_v1`

## Phase 0: Foundations (Week 1)
Goal: create shared design + telemetry infrastructure.

Frontend tasks:
- Introduce design tokens and semantic color roles in `apps/web/styles/globals.css`.
- Add reusable surface/button/input/tag primitives in `apps/web/components/ui/*`.
- Define motion tokens (durations/easing) and reduced-motion behavior.
- Add telemetry event helper usage in key flows (`apps/web/lib/clientTelemetry.ts`).

Platform tasks:
- Add lightweight feature-flag loader in web client (`apps/web/lib/featureFlags.ts`).
- Wire flags to safe defaults if remote flag fetch fails.

Acceptance:
- No visual regression on existing pages when flags are off.
- Tokenized theme can be turned on for landing/lobby only.

## Phase 1: Quick Play + Lobby V2 (Weeks 2-3)
Goal: make one-tap entry the default while preserving create/join code flows.

Backend tasks (Nakama):
- Add RPC `rpc_quick_play`:
  - Input: preferred stack/skill bucket (optional).
  - Output: `matchId`, `code`, `created`.
  - Behavior: join best available table, else create one.
- Add RPC `rpc_list_tables`:
  - Return active table cards (name, code, seats used/max, private/public, createdAt).
- Register RPCs in `apps/nakama/src/index.ts`.

Protocol/client tasks:
- Add RPC request/response types in `packages/protocol/src/index.ts`.
- Add client wrappers in `apps/web/lib/nakamaClient.ts`.

Frontend tasks:
- Rebuild `apps/web/pages/play.tsx` with primary `Play Now` CTA and secondary create/join drawers.
- Add lobby modules:
  - `apps/web/components/lobby/QuickPlayPanel.tsx`
  - `apps/web/components/lobby/TableListPanel.tsx`
  - `apps/web/components/lobby/RecentTablesPanel.tsx`
- Keep invite code flow intact as fallback.

Acceptance:
- User can tap once from `/play` to `/table/[matchId]` in one network round trip.
- Existing create/join by code still works.

## Phase 2: Table Readability V2 (Weeks 3-5)
Goal: maximize at-a-glance clarity during action.

Refactor tasks:
- Split `apps/web/components/PokerGamePage.tsx` into focused components:
  - `TableShell`
  - `TableHUD`
  - `SeatRing`
  - `HeroHand`
  - `ActionRail`
  - `ActivityFeed`
- Move inline styles into composable classes/CSS modules for maintainability.

UX tasks:
- Persistent HUD with high-contrast fields:
  - acting player
  - pot size
  - amount to call
  - phase/street
  - decision timer
- Progressive disclosure:
  - hide secondary logs/details by default
  - keep action controls and turn status always obvious
- Mobile-first action rail with thumb-safe controls.

Testing tasks:
- Add stable `data-testid` hooks for action buttons, turn indicator, pot, street.
- Update/add Playwright flows in `tests/e2e/play-flow.spec.ts`.

Acceptance:
- Player can identify turn, cost to continue, and pot in under 1 second on desktop and mobile.
- No regression in action legality and state sync.

## Phase 3: Discard Signature Flow (Weeks 5-6)
Goal: make discard the memorable interaction.

Frontend tasks:
- Add dedicated discard overlay component:
  - `apps/web/components/table/DiscardOverlay.tsx`
- Interaction design:
  - fan of cards
  - swipe up to burn (fast path)
  - tap + confirm (safe path)
- Add always-visible discard tracker (`5 -> 4 -> 3 -> 2`).
- Add opponent status chips (`discarded` complete state only).

State/logic tasks:
- Keep server-authoritative discard validation unchanged.
- Client should animate optimistic feedback but resolve from authoritative state.

Acceptance:
- Discard feels immediate and can be completed with one gesture.
- No leak of discarded-card identity to opponents.

## Phase 4: Social Lobby Layer (Weeks 6-8)
Goal: increase retention via friend-based re-entry.

Scope v1:
- Friends online rail on lobby.
- Join friend CTA when friend is seated in joinable table.
- Table chat toggle + reaction/emote strip with anti-spam cooldown.

Backend tasks:
- Add friend/presence RPCs in Nakama runtime (or integrate native friend APIs via thin wrappers).
- Add simple chat/emote event channel scoped to match.

Frontend tasks:
- `apps/web/components/lobby/FriendsPanel.tsx`
- `apps/web/components/table/TableChatDock.tsx`
- `apps/web/components/table/ReactionBar.tsx`

Acceptance:
- User can join a friend from lobby in <= 2 taps.
- Emotes/chat do not obstruct action controls.

## Phase 5: Progression Systems (Weeks 8-10)
Goal: add non-gambling retention loops.

Scope v1:
- Daily missions.
- Cosmetic unlock tracks (felt/chip/avatar skins).
- Seasonal ladder baseline (casual + competitive buckets).

Backend tasks:
- Mission generation/claim RPCs.
- User progression + cosmetics storage objects.

Frontend tasks:
- `apps/web/pages/profile.tsx`
- `apps/web/components/profile/MissionsCard.tsx`
- `apps/web/components/profile/CosmeticsGrid.tsx`
- `apps/web/components/profile/SeasonLadder.tsx`

Acceptance:
- Missions reset daily and progress from authoritative hand outcomes.
- Cosmetics apply live without gameplay impact.

## Cross-Cutting Engineering Requirements
- Keep gameplay authority server-side (`apps/nakama/src/pdhMatch.ts`).
- Add telemetry for every new funnel step and error condition.
- Maintain accessibility baseline:
  - keyboard navigation
  - color contrast
  - reduced motion
- Preserve responsive behavior for desktop and mobile.

## Execution Backlog (Starter Tickets)
P0 (must-do first):
1. `UX-001` Create tokenized theme system in `apps/web/styles/globals.css`.
2. `UX-002` Add feature-flag client and wire defaults.
3. `UX-003` Add telemetry events for funnel (`landing_cta`, `quick_play_click`, `table_joined`, `first_action`).

P1 (funnel):
1. `UX-010` Implement `rpc_quick_play` in `apps/nakama/src/pokerLobby.ts`.
2. `UX-011` Implement `rpc_list_tables` in `apps/nakama/src/pokerLobby.ts`.
3. `UX-012` Add protocol and client wrappers (`packages/protocol/src/index.ts`, `apps/web/lib/nakamaClient.ts`).
4. `UX-013` Rebuild `/play` around primary Quick Play CTA.

P2 (table clarity):
1. `UX-020` Split `PokerGamePage` into table subcomponents.
2. `UX-021` Build new HUD and action rail.
3. `UX-022` Add stable `data-testid` anchors and refresh e2e flows.

P3 (discard differentiator):
1. `UX-030` Build discard overlay + gesture handling.
2. `UX-031` Add discard progression tracker and opponent-ready indicators.
3. `UX-032` Add discard telemetry and performance instrumentation.

P4 (social/progression):
1. `UX-040` Friends panel + join friend.
2. `UX-041` Chat/reaction dock with cooldown.
3. `UX-050` Daily missions and profile stats.
4. `UX-051` Cosmetic unlock/equip path.

## Risks and Mitigations
- Risk: `PokerGamePage` refactor causes regressions.
  - Mitigation: ship behind `ui.table_v2`, keep old table path until parity.
- Risk: Quick Play seats users into poor-fit tables.
  - Mitigation: conservative matching first (open seat + latency + stack range), then tune.
- Risk: social widgets add clutter.
  - Mitigation: progressive disclosure and auto-hide during active turn.
- Risk: gesture discard conflicts with desktop UX.
  - Mitigation: support both swipe and explicit tap-confirm.

## Recommended Team Split
- Track A: Design system + landing/lobby (frontend).
- Track B: Nakama lobby RPC expansion (backend).
- Track C: Table UX refactor + discard signature (frontend + gameplay QA).
- Track D: Telemetry + experiment analysis (full-stack).

## Definition of Done for Redesign v1
- Quick Play is primary path and stable in production.
- Table clarity v2 is default and measurable improvements are verified.
- Discard overlay v2 is live and positively impacts discard completion speed.
- Regression suite (unit/integration/e2e) passes for join, action, discard, showdown flows.
