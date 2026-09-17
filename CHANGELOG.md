# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Required email/password player profiles, 10,000 welcome play chips, and unlimited fixed free top-ups with retry-safe receipts.
- Persistent account/table balances and counts for hands, table sessions, wins, rebuys and free top-ups, with an administrator player report.
- Private friend-table creation and server-enforced code admission, plus real-server profile, recovery and chip conservation coverage.

### Fixed
- Persistent-chip accounting ignores storage object key order, retries concurrent profile writes safely, and retains failed departures for refund recovery.
- Table error notices recover after a current server refresh, and dense mobile seats give player names more room with clearer status text.
- Duplicate settlement on discard disconnects, premature timeout actions during reconnect grace, stale table versions and queued next-hand choices.
- Mobile lobby, landscape actions, hand-history overlap, selectable cards and nine-seat positioning.
- Deployment now follows successful CI for the exact main commit, uses a tracked lockfile, builds before activation and retains rollback artifacts.


### Added

- Contributor workflow foundations: `CONTRIBUTING.md`, feature DoD checklist, and PR template.
- Shared `@pdh/protocol` package with versioned client/server contracts and Zod validation helpers.
- SQL migration and deterministic seed scaffolding (`db/migrations`, `db/seeds`, `db:migrate`, `db:seed`).

### Changed

- README now reflects the current Bondi Poker live game, lobby, table experience, and shipping flow.
- Nakama runtime and clients now use shared protocol validation and explicit protocol version tagging.
- Local developer startup now applies app SQL migrations and seed data.

### Fixed

- Root lint and changelog checks now run from Windows-friendly Node entrypoints.

### Security

- Invalid/unsupported protocol payloads are rejected through centralized schema validation.
