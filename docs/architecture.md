# Architecture

Orion separates **process** from **reasoning**. A deterministic engine owns the process — the
ordering, dependencies, parallelism, and human gates — while agents supply reasoning only
*inside* a single node. This document explains the components and how a run flows end to end.

## The big picture

```
┌──────────────────────────────────────────────────────────────┐
│   Web (React 19 + shadcn/ui Kanban + React Flow builder)      │
└───────────────────────────────┬──────────────────────────────┘
                                │  REST + SSE
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                   Orchestrator (Express)                       │
│   worktree isolation · event bus · node executors · RAG · MCP │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│           Workflow Engine — deterministic DAG scheduler        │
│              (no AI, no DB — pure ordering & gates)            │
└───────────────────────────────┬──────────────────────────────┘
                                │
        ┌───────────────┬───────┴───────┬────────────────┐
        ▼               ▼               ▼                ▼
  ┌──────────┐   ┌──────────┐    ┌──────────┐     ┌──────────┐
  │ harness  │   │   scm    │    │  board   │     │  comms   │
  │ (codex)  │   │ (github) │    │ (native) │     │(webhook) │
  └──────────┘   └──────────┘    └──────────┘     └──────────┘
                                │
                                ▼
              PostgreSQL / PGlite (Drizzle) — event-sourced runs
```

## The monorepo

Orion is an [Nx](https://nx.dev) monorepo of small, focused packages.

```
apps/
  orchestrator   Express: REST + SSE, hosts the engine, adapters, RAG and MCP
  web            React 19 + shadcn/ui Kanban board & visual workflow builder (Vite)
  web-e2e        Playwright E2E suite (mocked API, chromium only)
packages/
  shared/models          domain types shared across the workspace
  shared/adapter-kit     the shared provider registry every adapter builds on
  core/config            YAML + zod config loader, command templates, skills, DAG validation
  core/workflow-engine   deterministic DAG scheduler (no AI, no DB)
  core/rag               codebase indexing + embedding pipeline primitives
  data/db                Drizzle schema, client, repositories, migrations (Postgres + PGlite)
  adapters/harness/*     AI harness interface (core) + codex
  adapters/scm/*         source-control interface (core) + github
  adapters/board/*       board interface (core) + native, linear, jira, trello
  adapters/communication/*  notifier interface (core) + webhook, slack
```

## Components

### Workflow engine (`@orion/workflow-engine`)

A **deterministic, in-memory DAG scheduler**. It is the heart of Orion and the reason runs are
repeatable. It:

- Owns node ordering, dependency resolution, parallel fan-out, and approval gates.
- **Never** talks to an AI model, a shell, the network, or the database directly — all side
  effects are delegated to injected `NodeExecutor` implementations and a `RunStore` port.
- Enforces per-run token/cost budgets and per-node retry/timeout policy.

The main loop (`advance()`) runs in passes. Each pass: checks for failure and completion,
collects the outputs of finished nodes into a map for downstream data flow, finds every node
whose dependencies are all satisfied, and executes them **concurrently** with `Promise.all`.
A node that returns `waiting` (an approval) pauses the run until `approve()` resumes it.

See the [Workflows guide](./workflows.md) for node types, retries, matrix fan-out, loops, and
conditions.

### Orchestrator (`apps/orchestrator`)

An Express server that wires everything together. On startup it:

1. Loads environment variables and assembles a dependency-injection **container** (adapters,
   repositories, and services).
2. Runs database migrations.
3. Recovers interrupted runs — any run left mid-flight by a restart is marked failed so it
   surfaces on the board and can be retried.
4. Starts the cron **schedule** poller and the **board-sync** heartbeat.
5. Serves the REST + SSE API under `/api` and the MCP endpoints under `/mcp`.

Key services:

| Service | Responsibility |
| --- | --- |
| `RunService` | Coordinates runs, bounded concurrency, retry, and swimlane-entry triggers |
| `WorkspaceService` | Prepares isolated git worktrees and resolves the `.orion` config root |
| `ProjectService` | Project CRUD, config read/write, skill management |
| `ChatService` | Chat conversations, streaming turns, and intent routing |
| `ScheduleService` | Cron-based recurring agent jobs |
| `RagService` | Indexes and searches the codebase (see [Integrations](./integrations.md)) |
| `BoardSyncService` | Bidirectional sync with Linear / Jira / Trello |

Node execution is delegated to executors — one per node type — under
`apps/orchestrator/src/lib/executors/`: `agent`, `shell`, `approval`, `scm`, `message`,
`condition`, `http`, and `graphql`.

### Web app (`apps/web`)

A React 19 + Vite single-page app using shadcn/ui (Radix primitives) and Tailwind CSS.
Highlights:

- **Kanban board** with `@dnd-kit` drag-and-drop, live-updated over SSE.
- **Visual workflow builder** built on `@xyflow/react` (React Flow) that round-trips to the
  same YAML the engine consumes, with cycle prevention and auto-layout.
- **Dashboard, analytics, and evaluations** views for monitoring runs, cost, and quality.
- **Chat, schedules, codebase search, skills, and MCP** management pages.

It talks to the orchestrator with plain `fetch` (wrapped to unwrap the `{ data, success,
error }` envelope) and consumes live updates with the native `EventSource` API.

### Data layer (`@orion/db`)

Drizzle ORM over a Postgres-compatible database. The same schema, migrations, and repositories
work against a real Postgres server **and** embedded PGlite (Postgres compiled to WASM),
selected purely by the `DATABASE_URL` scheme. Runs are **event-sourced**: an append-only
`run_events` table records every transition and message, which powers both the audit trail and
SSE delivery.

## The adapter model

Every external integration sits behind a **category adapter** interface, built on a tiny shared
`ProviderRegistry` (`@orion/adapter-kit`). A provider declares a string `key`, registers itself
at runtime, and the engine resolves it by key with zero compile-time dependency on the concrete
implementation. Adding a provider is purely additive: implement the interface, register it, and
the engine and UI light up.

| Category | Interface | Implementations |
| --- | --- | --- |
| `harness` | `@orion/harness-core` | `codex` |
| `scm` | `@orion/scm-core` | `github` |
| `board` | `@orion/board-core` | `native` (+ sync clients for `linear`, `jira`, `trello`) |
| `communication` | `@orion/communication-core` | `webhook`, `slack` |

See the [Adapters guide](./adapters.md) for details on each.

## Worktree isolation

Every run executes in its own disposable git worktree so many tickets can run in parallel with
zero conflicts and your working checkout is never touched.

When a run starts, `WorkspaceService` discovers the project's member repositories (one for
`remote`/`local` projects, many for a `workspace` folder), creates a fresh worktree on a new
branch for each under `ORION_WORKSPACE_DIR/runs/<runId>/`, and resolves where
`.orion/config.yaml` lives. On completion the worktrees are cleaned up. For multi-repo
projects, agents run at the workspace level and the `scm` node opens **one pull request per
changed repository**.

## How a run flows

1. **Create a ticket** on the board (or sync one from Linear/Jira/Trello) and assign an agent.
2. **Start a run.** `RunService` admits it immediately if a concurrency slot is free, otherwise
   marks it `queued` and launches it FIFO as slots free up (`ORION_MAX_CONCURRENT_RUNS`).
3. **Prepare the workspace.** A fresh worktree is created on a new branch; the config is loaded
   and validated.
4. **Schedule the DAG.** The engine initializes nodes, then advances pass by pass — moving the
   ticket into each node's swimlane, running ready nodes concurrently, and delegating each to
   its executor.
5. **Agents reason inside `agent` nodes**, streaming messages, tool calls, and usage. `shell`,
   `http`, `graphql`, `scm`, `message`, and `condition` nodes run deterministically.
6. **Pause at approvals.** An `approval` node parks the run in your review swimlane until you
   click approve, then the engine resumes.
7. **Emit events throughout.** Every transition is written to `run_events` and streamed to the
   board over SSE. When all nodes reach a terminal state the run completes.

A failed or cancelled run can be **retried from the board** — it resumes from the last
successful node, preserving completed work and re-running the rest in a fresh worktree.

## Related reading

- [Configuration](./configuration.md) — the `.orion/config.yaml` schema.
- [Workflows](./workflows.md) — node types and execution policy.
- [Integrations](./integrations.md) — RAG, MCP, chat, schedules, and board sync.
- [API Reference](./api.md) — REST and SSE endpoints.
