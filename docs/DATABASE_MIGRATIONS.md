# Database Migrations and Seeding

Nakama manages its own core schema through `nakama migrate up`.

For app-owned relational data, this repo now provides SQL-first migration + seed foundations:

- Migrations: `db/migrations/*.sql`
- Seeds: `db/seeds/*.sql`
- Migration history table: `public.app_schema_migrations`
- Seed history table: `public.app_seed_runs`

## Commands

```bash
pnpm run db:migrate
pnpm run db:seed
```

Both commands:

- Use `.env` defaults (safe for local/test).
- Target the Postgres service from `docker-compose.dev.yml` by default.
- Are deterministic and idempotent by checksum tracking.

## Authoring Guidelines

- Use forward-only migrations (`0001_...sql`, `0002_...sql`, ...).
- Never edit an already-applied migration file.
- Seed files must be deterministic (`INSERT ... ON CONFLICT DO UPDATE`).
- Keep production data changes explicit and reviewable.

## CI/PR Expectations

If a feature introduces persistent data:

- Add migration(s) and seed updates in the same PR.
- Include rollback notes in PR description.
- Add integration coverage for new persisted behavior.
