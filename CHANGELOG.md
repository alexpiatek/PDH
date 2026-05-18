# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Contributor workflow foundations: `CONTRIBUTING.md`, feature DoD checklist, and PR template.
- Shared `@pdh/protocol` package with versioned client/server contracts and Zod validation helpers.
- SQL migration and deterministic seed scaffolding (`db/migrations`, `db/seeds`, `db:migrate`, `db:seed`).

### Changed

- README now reflects the current Bondi Poker live game, lobby, table experience, and shipping flow.
- Nakama runtime and clients now use shared protocol validation and explicit protocol version tagging.
- Local developer startup now applies app SQL migrations and seed data.

### Fixed

- Disconnecting during a discard phase no longer folds the player after auto-discarding or risks settling the same hand twice.
- Root lint and changelog checks now run from Windows-friendly Node entrypoints.

### Security

- Invalid/unsupported protocol payloads are rejected through centralized schema validation.
