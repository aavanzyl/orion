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

## Event Recording

Every feature that mutates state should emit events so the debug page, SSE streams, and notification
provider can surface them to users. Follow these rules when adding or changing behaviour:

- **Workflow engine changes**: When a run or node transitions between states, emit both the
  lifecycle event (e.g. `node.started`, `run.status`) and a `transition` / `run.transition` event
  so the debug log viewer can filter transitions independently.
- **Schedule changes**: When a scheduled agent fires, completes, or fails, emit schedule events
  (e.g. `schedule.fired`) on the `schedule` bus channel so the notification provider can relay
  them to the user.
- **New event types**: Extend `RunEventType` in `packages/shared/models/src/lib/event.model.ts`.
  If the event should trigger a user notification, also add a corresponding key to
  `NotificationEventKey` in `packages/shared/models/src/lib/settings.model.ts`.
- **Notification defaults**: Add sensible defaults in `apps/web/src/lib/use-preferences.ts`
  (`DEFAULT_EVENT_PREFS`) and render the toggle in the Notifications tab of the settings page
  (`apps/web/src/features/settings/settings-page.tsx`).
- **Notification provider**: Wire the new event type into
  `apps/web/src/features/notifications/run-notifications-provider.tsx` so notifications are
  dispatched when the event arrives over SSE.

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
