# Definition of Done

A feature/change is done only when all applicable items are complete.

## Engineering Quality

- [ ] Acceptance criteria are implemented and verified.
- [ ] Happy path and key failure paths are covered.
- [ ] No regression to existing gameplay or production behavior.
- [ ] Backward compatibility is preserved or explicitly versioned.

## Tests

- [ ] Unit tests added/updated for changed logic.
- [ ] Integration tests added/updated for client/server interactions.
- [ ] E2E test added/updated for user-critical flow (when applicable).
- [ ] Tests are deterministic (fixed seeds/controlled timing where possible).

## Contracts and API Safety

- [ ] Client/server message contracts updated in `@pdh/protocol`.
- [ ] Zod validation updated for new/changed payloads.
- [ ] Protocol versioning impact assessed (`PDH_PROTOCOL_VERSION`).
- [ ] Unknown/invalid payload behavior is explicit and tested.

## Data and Operations

- [ ] DB migration included for schema changes (`db/migrations`).
- [ ] Deterministic seeds updated when needed (`db/seeds`).
- [ ] Rollback/mitigation notes documented for risky changes.

## Observability and Security

- [ ] Structured logs include enough context (`matchId`, `userId`, `handId`, `actionSeq`).
- [ ] Error paths produce actionable diagnostics without leaking secrets.
- [ ] Replay/debug hooks updated when state transitions changed.
- [ ] Auth/turn/phase/idempotency protections are preserved.

## Documentation and Release Notes

- [ ] User/dev docs updated (`README`, runbooks, relevant docs).
- [ ] `CHANGELOG.md` updated under `[Unreleased]`.
- [ ] PR includes risk summary, test evidence, and rollout notes.
