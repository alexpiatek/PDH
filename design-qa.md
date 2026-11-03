# Coastal first-play design QA

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
- Lint, supported typecheck, changelog validation and optimized web build passed. Shellcheck was unavailable and the repository's lint runner reported that skip.

## Release gaps and follow-up

- Real two-player gameplay, successful authenticated resume and integration/E2E jobs still require the normal CI/server environment. Docker is unavailable in this workspace. Updated E2E scenarios are included for CI, but were not executed locally through the CLI.
- HTTPS clipboard success must be confirmed on the release preview/live origin; manual fallback was verified here.
- Domain/DNS work is separate and has not been changed.
- No database, Nakama runtime, campaign, account balance or protocol migration is part of this change.

## Implementation checklist

- [x] Chosen direction and Brad card styling implemented.
- [x] Practice, friend-table lobby, contextual account entry and solo invitations implemented.
- [x] Combined source/implementation comparison and focused comparison reviewed after fixes.
- [x] Mobile and important interaction states inspected.
- [x] Regression tests, release notes and flow documentation updated.
- [ ] Server-backed CI and release smoke test before merging/deploying.

final result: passed
