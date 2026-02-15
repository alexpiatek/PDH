# Contributing

## Branch and Commit Conventions

- Branch names:
  - `feat/<short-scope>` for features
  - `fix/<short-scope>` for bug fixes
  - `chore/<short-scope>` for tooling/docs/refactors
- Commit format: conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Keep changes small and reviewable. Prefer additive and backward-compatible changes.

## Golden Path for Shipping Features Safely

1. Start from latest `main`.
2. Implement the smallest vertical slice.
3. Add or update tests closest to changed logic first.
4. Update contract/docs/changelog in the same PR.
5. Run quality gates locally.
6. Open PR with risk notes and rollback plan.
7. Merge only after CI is green and review checklist is complete.

## Local Quality Gates

Run from repo root:

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:integration
pnpm run test:e2e
pnpm run changelog:check
```

DB migration + seed baseline:

```bash
pnpm run db:migrate
pnpm run db:seed
```

## Pull Request Conventions

- Include scope, behavior change, and risk summary.
- Link issues/incidents if relevant.
- Include screenshots/video for UI changes.
- Mention contract changes explicitly (`@pdh/protocol`, opcodes, payload shape).
- Include deployment/backfill notes when migrations are added.

## Review Checklist

- [ ] Logic change has tests (unit/integration/e2e as needed).
- [ ] No client-authoritative behavior introduced.
- [ ] Protocol changes are versioned and validated.
- [ ] Observability updated (`docs/observability.md`, structured logs, replay hooks).
- [ ] Security-sensitive paths reviewed (auth, turn validation, idempotency, CORS/headers).
- [ ] Changelog updated under `[Unreleased]`.
- [ ] Docs updated (`README`, runbooks, contracts) when behavior changed.

## Definition of Done

Use `docs/DEFINITION_OF_DONE.md` for feature completion criteria before merge.
