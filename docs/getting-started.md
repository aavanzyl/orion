# Getting Started

Orion runs as two services — an **orchestrator** (Express REST + SSE API that hosts the
workflow engine) and a **web** app (React Kanban board and workflow builder) — backed by a
Postgres-compatible database.

There are three ways to run it:

- [Docker](#running-with-docker-recommended) — the fastest path; builds and serves everything.
- [Local development](#local-development-without-docker) — Nx dev servers against a local Postgres.
- [Embedded PGlite](#embedded-database-no-postgres) — zero-setup, in-process Postgres (WASM).

## Prerequisites

- **Node.js 22+** and **npm** (for local development).
- **Docker** with Compose (for the containerized path).
- Optionally, a **Codex/OpenAI-compatible API key** and a **GitHub token** to let agents
  actually reason and open pull requests.

## Running with Docker (recommended)

`docker compose up` builds everything, applies database migrations, and serves the whole
stack. Services bind to `0.0.0.0`, so other devices on your network can reach the board.
Apps use the `8400–8402` port range.

```bash
cp .env.example .env   # optional: set CODEX_API_KEY / CODEX_BASE_URL / GITHUB_TOKEN
docker compose up -d --build
```

| Service | URL | Notes |
| --- | --- | --- |
| Web (board) | `http://<host>:8401` | nginx serves the UI and proxies `/api` |
| Orchestrator | `http://<host>:8400` | REST + SSE API |
| Postgres | `<host>:8402` | user/pass/db: `orion` |

Migrations run automatically when the orchestrator container starts (it points
`ORION_MIGRATIONS_DIR` at the bundled migrations). Because the web container proxies `/api`
to the orchestrator, the board works from any device without rebuilds.

### Using local/workspace projects with Docker

To point Orion at a `local` checkout or a `workspace` folder on your host, the orchestrator
bind-mounts a host directory at the **same absolute path** inside the container (defaults to
your home directory). Narrow it with `ORION_PROJECTS_DIR`:

```bash
ORION_PROJECTS_DIR=/Users/you/Documents/Development
```

Isolated worktrees are created under the managed `orion-workspace` volume, so your local
checkouts are never modified in place.

```bash
docker compose logs -f orchestrator   # follow logs
docker compose down                    # stop
docker compose down -v                 # stop and drop the database + workspace volumes
```

## Local development (without Docker)

1. Install dependencies and start Postgres:

   ```bash
   npm install
   docker compose up -d postgres
   cp .env.example .env
   npx nx run @orion/db:db:migrate
   ```

2. Run the orchestrator API and the board in separate terminals:

   ```bash
   npx nx serve @orion/orchestrator   # http://localhost:3333
   npx nx dev @orion/web              # http://localhost:4200
   ```

The web app talks to the API at `http://localhost:3333/api` by default. Override it with the
`VITE_API_URL` environment variable, or from the in-app settings (the override is stored in
`localStorage`).

## Embedded database (no Postgres)

For a quick local try without Docker or a Postgres server, point `DATABASE_URL` at
[PGlite](https://pglite.dev) — real Postgres compiled to WASM, running in-process:

```bash
DATABASE_URL=pglite://./.orion/pgdata npx nx serve @orion/orchestrator
```

The orchestrator creates the embedded database at that path (use `pglite://memory` for an
ephemeral in-memory database) and auto-applies the same migrations on boot, so there are no
manual setup steps. Because PGlite *is* Postgres, it reuses the existing schema, migrations,
and repositories unchanged. Postgres remains the default and is recommended for shared or
production deployments.

## Environment variables

All variables are read by the orchestrator at startup (see `.env.example`). Only
`DATABASE_URL` is required.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | **required** | `postgres://…` or `pglite://…` (`pglite://memory` for in-memory) |
| `HOST` | `localhost` | Express bind address |
| `PORT` | `3333` | Express port |
| `ORION_WORKSPACE_DIR` | `./.orion-workspace` | Where managed clones and run worktrees live |
| `ORION_PROJECTS_DIR` | `$HOME` | Root for the in-app filesystem browser (and the Docker bind mount) |
| `CODEX_API_KEY` | — | Codex harness API key (OpenAI or any OpenAI-compatible provider) |
| `CODEX_BASE_URL` | — | Base URL override for non-OpenAI providers (e.g. `https://api.deepseek.com`) |
| `GITHUB_TOKEN` | — | Used by the GitHub SCM adapter (push, PRs) and to install skills from private repos |
| `ORION_NOTIFY_WEBHOOK_URL` | — | POST run lifecycle notifications to a Slack/Discord-compatible webhook |
| `ORION_SLACK_WEBHOOK_URL` | — | Slack incoming webhook; registers a `slack` notifier for `message` nodes |
| `ORION_MAX_CONCURRENT_RUNS` | `3` | Max concurrent runs (`0` = unlimited); extra runs are queued |
| `ORION_PUBLIC_URL` | `http://<HOST>:<PORT>` | Public URL used to build MCP SSE self-links injected into agents |
| `ORION_CODEBASE_MCP` | `true` | Auto-inject the codebase search MCP into agent runs |
| `ORION_BOARD_SYNC_INTERVAL_MS` | `600000` | How often connected boards (Linear/Jira/Trello) are pulled (10 min) |
| `PROVIDER_ENCRYPTION_SALT` | — | Salt for AES-256-GCM encryption of secrets at rest (provider keys, board tokens) |
| `ORION_MIGRATIONS_DIR` | bundled | Override the migrations directory (set in Docker) |

> **Secrets at rest** — When `PROVIDER_ENCRYPTION_SALT` is unset, provider API keys and
> board-connection tokens are stored as plaintext in the database. Set a salt in any shared
> or production deployment.

### Web build-time variables

The web app reads a few `VITE_`-prefixed variables at build time:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:3333/api` | API base URL (also overridable in-app) |
| `VITE_APP_VERSION` | from `package.json` | Version shown in the UI |
| `VITE_APP_GIT_SHA` | `git rev-parse --short HEAD` | Commit shown in the UI |

## Verifying your setup

```bash
npx nx run-many -t typecheck lint test   # typecheck, lint, and unit-test everything
```

See [AGENTS.md](../AGENTS.md) for the full testing matrix, including the orchestrator
integration suite (over in-memory PGlite) and the Playwright E2E suite.

## Next steps

- [Configure a repository](./configuration.md) with `.orion/config.yaml`.
- Learn the [workflow node types](./workflows.md).
- Understand the [architecture](./architecture.md).
