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

- Nakama runtime and clients now use shared protocol validation and explicit protocol version tagging.
- Local developer startup now applies app SQL migrations and seed data.

### Fixed

- _none_

### Security

- Invalid/unsupported protocol payloads are rejected through centralized schema validation.
