# AGENTS.md

## Testing

All tests are network-free and deterministic. Run them with Nx.

- Unit tests (all projects): `npx nx run-many -t test`
- A single project: `npx nx run @orion/<project>:test` (e.g. `@orion/db`, `@orion/config`, `@orion/rag`, `@orion/web`)
- Orchestrator integration tests (Express API over in-memory PGlite): `npx nx run @orion/orchestrator:test`
- Web E2E (Playwright, chromium only, mocked API):
  1. `npx playwright install chromium`
  2. `npx nx run web-e2e:e2e`
- Typecheck + lint (all projects): `npx nx run-many -t typecheck lint`
- Build the web app: `npx nx run @orion/web:build`

### Notes

- The orchestrator integration specs (`apps/orchestrator/src/test/*.integration.spec.ts`) build the API
  with `createTestApp()` from `apps/orchestrator/src/test/app.ts`. It uses `DATABASE_URL=pglite://memory`
  so the container assembles an embedded PGlite database, applies migrations with `runMigrations`, and is
  driven with `supertest` — no external Postgres, Codex, GitHub, or Linear access.
- The E2E suite (`apps/web-e2e`) previews the production web bundle (`npx nx run @orion/web:preview`) and
  stubs every `/api/**` call with `page.route`, so no orchestrator needs to be running.

## Docker

- Deploy (rebuild on changes): `docker compose up -d --build`
- Deploy from scratch (invalidate cache): `docker compose build --no-cache && docker compose up -d`
- View running containers: `docker compose ps`
- View logs: `docker compose logs -f <service>` (e.g. `orchestrator`)
- Stop: `docker compose down`

### Ports (all exposed to localhost)

| Service      | Container Port | Host Port |
|-------------|---------------|-----------|
| Web         | 80            | 8401      |
| Orchestrator| 3333          | 8400      |
| Postgres    | 5432          | 8402      |
