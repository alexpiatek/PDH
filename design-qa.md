## Player experience beyond the homepage — 3 November 2026

**Local result: passed.** The existing coastal direction now continues through the lobby, live table, profile, 404/error and email-preference pages. The account gate, practice hand and friend invitation room were reviewed alongside them. Game screenshots use the existing network-disabled hand fixtures; the profile screenshot uses the actual shared profile view with synthetic totals. No production player account, chip balance, campaign or message was used for this review.

### Findings and changes

1. **Mobile gameplay — high priority, repaired.** At six players on a 390px phone, an opponent nameplate overlapped the hero seat. At 375 × 667, the betting bar covered the hand; opening Raise also hid the hand on a 390px phone. Six-player tables now use the compact seat arrangement, shorter screens reserve room for the controls, and the mobile raise editor focuses on amount, presets and confirmation. The cards stay visible. The original all-in confirmation remains in place. Geometry checks cover four through nine seats, short phones and the expanded raise editor.
2. **Understanding the game — clearer during play.** The lobby and table show how five cards become four, three and two. The table guide opens the existing rules without leaving the hand. An empty preflop board explains when the first discard happens. Discard cards are real keyboard-operable buttons with pressed state, a gold selection, and the selected card named above confirmation. Rules take keyboard focus, contain Tab, close with Escape and restore focus. Betting shortcuts pause while menus or rules/history are open.
3. **Player journey — consistent and easier to scan.** The lobby leads with creating or joining a friend table, with practice still available. Brad's ocean photograph is used on concealed cards; readable card faces are retained. Available chips and four key hand totals lead the profile, with detailed accounting available in a disclosure. Top-up receipt handling, account APIs, password requirements and administrator checks are retained. The result banner is more readable on phones and the next-hand message uses player-facing wording. Missing-page and email-preference screens use the shared coastal shell.

### Current-review evidence

- [Table before](docs/qa/player-experience/table-before.jpg) and [table after](docs/qa/player-experience/table-after.jpg)
- [Lobby before](docs/qa/player-experience/lobby-before.jpg) and [lobby after](docs/qa/player-experience/lobby-after.jpg)
- [Six-seat overlap before](docs/qa/player-experience/mobile-table-before.jpg), [nine-seat phone after](docs/qa/player-experience/mobile-nine-after.jpg), [short phone after](docs/qa/player-experience/mobile-six-short-after.jpg)
- [Raise editor before](docs/qa/player-experience/raise-mobile-before-layout.jpg), [phone after](docs/qa/player-experience/raise-mobile-after.jpg), [short phone after](docs/qa/player-experience/raise-mobile-short-after.jpg)
- [Keyboard-selected discard](docs/qa/player-experience/discard-mobile-short-after.jpg) and [long hand result](docs/qa/player-experience/showdown-long-mobile-after.jpg)
- [Profile desktop](docs/qa/player-experience/profile-desktop-after.jpg), [profile phone](docs/qa/player-experience/profile-mobile-after.jpg), [page recovery](docs/qa/player-experience/error-after.jpg)

All accepted images were captured and inspected in this review. Desktop review used the normal Chrome viewport; phone checks used 390 × 844 and 375 × 667. Before/after screenshots may differ in the local-only device-sharing helper, which is now limited to the waiting room. Profile baseline review was source-based because the live page requires a signed-in account; no production account was created for screenshots. The shared profile preview and poker fixtures return 404 unless the existing test-state environment switch is explicitly enabled. This is a visual/interaction review, not a measured conversion or comprehensive accessibility study. Private administrator reports and the low-level app crash boundary are outside this visual pass.

Local lint, type checks, production web build and all 254 unit tests passed; six database-dependent campaign tests were skipped locally. Added browser coverage checks seat separation, short-phone hand visibility, raise editing/all-in confirmation, keyboard discard selection and rules focus. The repository's server-backed integration and browser CI remain the pre-merge release gate. No protocol, poker rules, server-authoritative action validation, dependencies, database schema or DNS change is required. Release uses the existing tested-commit deployment workflow and its artifact rollback.

# Coastal first-play design QA

## Five-card clarity and X-first community — 3 November 2026

**Local review: passed.** Compared Brad's original homepage source at `659535f`, the live `8790357` homepage, and this revision in the same desktop browser frame. Brad's source was rendered locally with the current runtime and original assets; it is a content/layout reference, not a reconstruction of the historical production environment. Temporary reference code and its route were removed before the final build.

1. **Variant comprehension — clearer.** Brad's “new kind of online Hold’em” and visible discard flow explained the alternative game more directly than the previous generic poker-night headline. The revision leads with “A new kind of Hold’em. Start with five. Finish with two.” and gives the face-down discard timing immediately below.
2. **Community entry — visible and working through X.** The owner requested X first, then Discord. “Join us on X” is visible with the main entry points and goes to the verified public `@BondiPoker` profile. Discord's current `tmkeanX7T` invite returned error 10006, “Unknown Invite”. The stale hardcoded fallback was removed; empty public configuration omits Discord entries across the homepage, shared navigation, footer and waiting room. A fresh verified invite can restore the secondary entries through the existing public build setting.
3. **Game feel and entry — improved.** Brad's original photo cards are larger and fanned into an opening hand, with a small five-card label and readable felt caption. The whole illustration opens the real practice hand. Practice is the primary no-account action; multiplayer and join-by-code remain available. No fake player counts, pots or live activity were added.

### Current-review evidence and limits

- [Brad's source rendering](docs/qa/five-card-clarity/brad-original.jpg)
- [Previous live homepage](docs/qa/five-card-clarity/previous-live.jpg)
- [Revised desktop](docs/qa/five-card-clarity/desktop.jpg)
- [Revised 390px mobile](docs/qa/five-card-clarity/mobile.jpg)
- [Combined comparison](docs/qa/five-card-clarity/comparison.jpg)

All accepted images were captured and inspected during this review. The three desktop sources have the same 1466px content width; the comparison crops their top frames to the same height and scales them equally. On the 390px phone frame, the headline, practice entry, X link and all five cards are visible without horizontal overflow. The entire table illustration was followed into practice, where the five-card hand and disabled-until-selection discard control were verified. Existing readable practice/live cards and game logic remain unchanged. This is a visual and interaction review, not a measured conversion or full accessibility study.

Lint, repository typecheck, changelog check and production web build passed. All 254 local unit tests passed; six database-dependent campaign tests were skipped locally. Server-backed integration/E2E CI is the pre-merge gate. Deployment must clear only the known invalid public Discord setting, retain a protected copy of its previous environment file, and use the existing exact-tested-commit web workflow. No secret values, campaigns, accounts, database, protocol, backend, dependencies or DNS are changed.

## Homepage refinement — 3 November 2026

**Local result: passed.** This follow-up keeps the selected dark coastal direction and responds to the homepage review. It changes presentation only; practice logic, account entry, invitations, campaigns and server contracts are unchanged.

### Review steps and resulting changes

1. **Hero — clearer.** The current live page was captured before editing. Repeated table badges, the extra invite button and the duplicate join link competed with the main action. The result leads with “Poker night. With your people.” and one gold “Play with friends” action beside practice. Join-by-code is in the header, with social destinations still in the footer.
2. **Game explanation — clearer.** The 5/4/3/2 rank artwork could be read as card values rather than hand sizes. It is replaced by a single ordered explanation: five private cards, one hidden discard after each post-flop betting round, then two cards at showdown. The practice link remains adjacent.
3. **Artwork and practice — preserved.** Brad's original `b8638e6` photo-card composition and all five original photographs are restored on the homepage. Practice and live play retain `MinimalCardFace`. The coast now fades into the page before the photograph ends. Completed the practice hand through Two Pair and restarted to five cards with discard disabled until selection.

### Accepted evidence

- [Desktop hero](docs/qa/coastal-refinement/desktop.jpg)
- [Narrow phone at 320px](docs/qa/coastal-refinement/mobile-320.jpg)
- [Completed practice at 320px](docs/qa/coastal-refinement/practice-complete.jpg)
- [Before/after comparison](docs/qa/coastal-refinement/comparison.jpg)

All images were captured and inspected in this review. The comparison uses the same 1466px content width and the top 765px of each desktop capture, then scales both equally for the comparison sheet. Responsive layouts were inspected at 320px, 390px and desktop sizes; DOM bounds showed no horizontal overflow. The narrow header keeps the logo, join link and sign-in control separate. Images have accessible card names; the main controls retain focus outlines and 44px minimum target heights. This is not a full assistive-technology or physical-device accessibility audit.

### Validation and release

- Lint, repository typecheck, changelog check and optimized production web build passed. Shellcheck is unavailable locally and the existing lint runner skips it.
- Existing unit suites: 254 passed; six database-dependent campaign tests skipped locally.
- Practice completed all three discards, produced the engine-derived Two Pair result, and restarted correctly without account creation.
- Server-backed integration and browser E2E remain required in CI before merging. Use the existing tested web deployment workflow and retain the previous release for rollback. No dependency, runtime, protocol, database, account or DNS changes are included.

## Original first-play QA record

The earlier report below documents the original PR #21 implementation before this homepage refinement.

**Final result: passed**

No actionable P0/P1/P2 visual findings remain in the reviewed states. This is a visual and local interaction result, not a claim that real-server multiplayer or production deployment has been verified.

## Visual targets and evidence

- Source visual truth: selected direction 2, “Your table, your people,” preserved in [source.webp](docs/qa/coastal/source.webp). Original: 1487 × 1058 pixels.
- Implementation: [desktop.webp](docs/qa/coastal/desktop.webp), [mobile.webp](docs/qa/coastal/mobile.webp), [account.webp](docs/qa/coastal/account.webp), [waiting.webp](docs/qa/coastal/waiting.webp), [waiting-mobile.webp](docs/qa/coastal/waiting-mobile.webp), [practice-complete.webp](docs/qa/coastal/practice-complete.webp).
- Full-view source and implementation were placed together and inspected: [comparison.webp](docs/qa/coastal/comparison.webp).
- Focused hero, typography and card comparison: [detail.webp](docs/qa/coastal/detail.webp).
- State: signed-out homepage; fresh lobby; invitation RZ587G at account entry; deterministic solo waiting-room snapshot; completed practice hand.
- Browser: cloud Chrome. Desktop reference frame 1487 × 1058 CSS pixels (1472px content width plus scrollbar), displayed at 0.85 scale to fit the browser. Raw capture 1363 × 936 pixels; surrounding canvas and scrollbar cropped to 1251 × 900 for comparison. Source and implementation were normalized to 700px widths in the combined evidence. This is a desktop viewport, not a mobile page scaled up.
- Mobile frames: 390 × 844 and 375 × 667 CSS pixels, 1:1 scale. The 390px scrolling homepage/lobby have 375px content widths after the scrollbar. No horizontal overflow was observed. The solo invitation and its controls fit at both sizes.

## Findings and comparison history

1. **P2, resolved — mobile sign-in link hidden.** Restored the link and made the community navigation compact, with accessible names and 44px-high targets. Verified in the mobile capture.
2. **P2, resolved — desktop primary actions and teaching strip underemphasized.** Increased the desktop hero controls from 14px/52px to 18px/62px and reused the existing deck in the 5→4→3→2 guide. A follow-up capture caught an arrow selector shrinking nested card SVGs; scoped it to direct-child arrows. The final combined capture shows the full card faces and stronger actions.
3. **Preview environment issue, resolved.** Starting Next from the monorepo root omitted some Tailwind utilities, making the existing table logo oversized. Corrected the preview working directory to `apps/web`, checked the production build and recaptured the account and waiting-room screens. No production logo redesign was needed.

The final comparison was made after these fixes. No additional blocking visual change was identified.

## Required fidelity surfaces

- **Typography:** existing Cormorant Garamond editorial headings and Manrope UI text reproduce the selected serif/sans hierarchy. Cream headings wrap cleanly in two desktop lines; mobile headings and controls remain legible. The implementation keeps normal web UI sizing rather than reproducing every raster mock label size exactly.
- **Spacing/layout:** two-column desktop hero, oval table, clear primary/secondary actions, gold separators and learning strip retain the chosen composition. Mobile stacks content without horizontal clipping. Additional rules appear below the teaching strip, and the invitation entry remains visible beside the main actions.
- **Colors/tokens:** dark teal ocean/felt, warm cream copy and gold actions. Selection, disabled, focus and error states are distinct. Primary controls retain strong contrast.
- **Images/assets:** generated coast and transparent table assets fit their slots without obvious stretching or halos. The existing brand mark and live minimal card component are reused. Brad's court-card shapes and the surf detail are shared by homepage, practice and live deck. This deliberately replaces the mock's generic oversized pips and decorative card stacks with the product's actual cards.
- **Copy/content:** explicitly describes discarding after flop, turn and river betting; practice states that betting is skipped. Account requirements apply to multiplayer. Play chips have no purchase/cash/withdrawal promise. Table preview does not invent occupied seats or live player counts.

## Interactions and checks

- Followed homepage practice CTA.
- Selected and confirmed three different discards: 5 → 4 → 3 → 2 cards; saw the engine-derived Two Pair result and best five cards.
- Restarted practice and verified five cards plus a disabled discard button until selection.
- Opened a valid invitation and switched create-profile/sign-in modes; the table code remained visible and the URL retained the intent. No real account was created or credentials submitted.
- Inspected desktop and both mobile solo waiting states using the existing gated snapshot route. Invitation URL and actual snapshot seat count were shown. In the HTTP preview, clipboard access was unavailable and the manual-copy guidance appeared, without falsely reporting success.
- Checked application error logs after the practice flow: no application errors. Browser-extension metadata warnings were excluded from app findings.
- Unit tests: 254 passed, 6 database-dependent campaign tests skipped. Includes all 60 practice discard paths, invalid selections, and allowlisted invitation/action URL parsing.
- A clean CI checkout exposed a missing engine-build prerequisite for the new practice test. The test runner now builds the shared engine first; all 254 tests also passed locally after removing the previous engine build.
- Lint, supported typecheck, changelog validation and optimized web build passed. Shellcheck was unavailable and the repository's lint runner reported that skip.
- CI run [41597372837](https://github.com/alexpiatek/PDH/actions/runs/41597372837) passed lint/typecheck, both server integration modes, and the full browser E2E suite for frontend commit `397b00ab`. The final follow-up changes only the test-runner prerequisite and this evidence; current-head CI repeats those checks.

## Release gaps and follow-up

- Real two-player gameplay and integration/E2E passed in CI. Docker is unavailable in this workspace, so the suite was not executed locally through the CLI. Successful authenticated resume still needs a release-environment smoke test.
- HTTPS clipboard success must be confirmed on the release preview/live origin; manual fallback was verified here.
- Domain/DNS work is separate and has not been changed.
- No database, Nakama runtime, campaign, account balance or protocol migration is part of this change.

## Implementation checklist

- [x] Chosen direction and Brad card styling implemented.
- [x] Practice, friend-table lobby, contextual account entry and solo invitations implemented.
- [x] Combined source/implementation comparison and focused comparison reviewed after fixes.
- [x] Mobile and important interaction states inspected.
- [x] Regression tests, release notes and flow documentation updated.
- [x] Server-backed integration and browser E2E passed for the frontend changes.
- [ ] Final-head CI and authenticated release smoke test before merging/deploying.

final result: passed
