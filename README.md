<div align="center">

<img src="assets/banner.png" alt="Orion" width="820" />

<h3>The workflow owns the process. The agent owns the reasoning.</h3>

<p>
Orion is an <strong>AI workflow orchestrator</strong> for building software with autonomous agents.<br/>
Not a chat wrapper around a model — a <strong>deterministic engine</strong> that drives coding agents through a<br/>
DAG of steps you define, tracked live on a Kanban board.
</p>

<p>
  <img src="https://img.shields.io/badge/license-MIT-6366f1.svg" alt="License: MIT" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6.svg?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61dafb.svg?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/Nx-monorepo-a855f7.svg" alt="Nx" />
  <img src="https://img.shields.io/badge/PostgreSQL-Drizzle-38bdf8.svg?logo=postgresql&logoColor=white" alt="Postgres" />
  <img src="https://img.shields.io/badge/Docker-compose%20up-2496ed.svg?logo=docker&logoColor=white" alt="Docker" />
</p>

</div>

---

When you ask an AI agent to "fix this bug," what actually happens depends on the model's mood. It might skip investigation. It might forget to run the tests. It might open a pull request nobody reviewed. Every run is different, and none of it is yours to control.

**Orion flips the script.** You encode your development process as a workflow — a directed graph of steps with dependencies, validation gates, and human approvals. A deterministic engine owns that process and schedules each step in order. The agent only supplies reasoning *inside* a step. The structure is repeatable, auditable, and owned by you.

> Think of the Orion constellation itself: a handful of bright stars, connected into a shape you recognize instantly. That's your workflow — a graph of nodes, wired together, that runs the same way every single time.

## Why Orion?

- **Deterministic by design** — The engine is a pure DAG scheduler. It handles ordering, dependencies, parallelism, and approvals, and it *never* talks to a model directly. Same workflow, same sequence, every run.
- **Human-in-the-loop, first-class** — `approval` is a real node type. The run pauses, the ticket lands in your review swimlane, and nothing proceeds until you click approve.
- **Isolated by default** — Every run executes in its own disposable git worktree. Run many tickets in parallel with zero conflicts; your working checkout is never touched.
- **Watch it think** — Every node transition, agent message, tool call, and log line is event-sourced and streamed live to the board over SSE. Open a ticket and watch the work happen.
- **Yours, in your repo** — Board swimlanes, workflows, commands, and skills live in a single `.orion/config.yaml`, version-controlled next to your code. Your whole team runs the same process.
- **Provider-agnostic & pluggable** — Every integration — AI harness, source control, board, chat — sits behind a category adapter. Point the Codex harness at OpenAI, DeepSeek, or any OpenAI-compatible endpoint. Swap parts without touching the engine.
- **Codebase-aware agents** — Orion indexes your repository and exposes semantic search to agents over the Model Context Protocol (MCP), so they ground their reasoning in your actual code.
- **Multi-repo native** — A project can be one repo *or* a workspace folder of many. Agents run at the workspace level and open one pull request per changed repository.

## Documentation

Detailed guides live in [`docs/`](./docs):

| Guide | What's inside |
| --- | --- |
| [Getting Started](./docs/getting-started.md) | Docker, local dev, embedded PGlite, and every environment variable |
| [Architecture](./docs/architecture.md) | Components, the adapter model, and how a run flows end to end |
| [Configuration](./docs/configuration.md) | The full `.orion/config.yaml` schema and command templates |
| [Workflows](./docs/workflows.md) | Every node type, retries, parallel fan-out, matrix, loops, conditions, sub-workflows |
| [Skills](./docs/skills.md) | The skill catalog, materialization, and installing from GitHub |
| [Adapters](./docs/adapters.md) | Harness, SCM, board, and communication providers |
| [Integrations](./docs/integrations.md) | Codebase RAG, MCP servers, chat, schedules, and board sync |
| [API Reference](./docs/api.md) | REST and SSE endpoints |

## What It Looks Like

Define your process once. Here's the default workflow — investigate, implement, verify, get a human approval, then open the PR:

```yaml
# .orion/config.yaml
project:
  name: example-service
  defaultBranch: main

board:
  swimlanes: [backlog, investigating, in_progress, review, done]

workflow:
  name: default
  nodes:
    - id: investigate
      type: agent                   # AI reasons, no code changes
      provider: codex               # harness adapter key
      model: gpt-5-codex
      # baseUrl: https://api.deepseek.com   # any OpenAI-compatible endpoint
      instructions: commands/investigate.md
      skills: [conventional-commits, pr-description]   # from the skill catalog
      swimlane: investigating

    - id: implement
      type: agent
      provider: codex
      model: gpt-5-codex
      instructions: commands/implement.md
      dependsOn: [investigate]
      swimlane: in_progress

    - id: verify
      type: shell                   # deterministic — no AI
      script: "npm test"
      dependsOn: [implement]
      swimlane: in_progress

    - id: approval
      type: approval                # pauses for a human
      dependsOn: [verify]
      swimlane: review

    - id: open_pr
      type: scm                     # commits, pushes, opens the PR
      action: open_pull_request
      dependsOn: [approval]
      swimlane: done
```

<div align="center">
<img src="assets/workflow.png" alt="The Orion workflow: investigate → implement → verify → approval → open PR" width="880" />
</div>

Prefer clicking to typing? Orion ships a **visual workflow builder** (React Flow) that round-trips to the same YAML, and a library of built-in workflow templates to start from.

Then just work the board. Drop a ticket, assign an agent, and hit **Start Run**:

```text
Ticket #42  ·  "Fix flaky checkout total on empty cart"

  → worktree created on branch orion/ticket-42 …
  → investigate  · agent reading codebase, finding root cause …
  → implement    · editing cart.ts, adding a regression test …
  → verify       · npm test → 128 passing
  → approval     · ⏸ waiting for you in the Review swimlane
        (you click Approve)
  → open_pr      · pushed & opened https://github.com/you/shop/pull/91
```

Every arrow above is a live event on the board. Nothing is a black box.

## Core Concepts

| Concept | What it is |
| --- | --- |
| **Project** | A repository *or* a folder of repositories. Its board, workflows, commands, and skills come from `.orion/config.yaml` at the source root. Sources can be `remote` (a git URL Orion clones), `local` (an existing checkout), or `workspace` (a parent folder of many repos sharing one board). |
| **Ticket** | A unit of work on the board. An agent picks it up and runs the workflow. Tickets can be created in Orion or synced from Linear, Jira, or Trello. |
| **Workflow** | A DAG of nodes. The engine schedules each node as its dependencies complete, runs independent branches in parallel, and pauses on approvals. |
| **Run** | One execution of a workflow for a ticket, isolated in its own git worktree. Every step emits event-sourced events, streamed live to the board. |

**Nine node types, one clean contract:**

- 🧠 `agent` — an AI turn driven by a rendered instruction template. Streams messages and tool calls. Supports loops and matrix fan-out.
- ⚙️ `shell` — a deterministic script (`npm test`, a linter, a build). No AI.
- ✋ `approval` — a human gate. The run parks in your review swimlane until you approve.
- 🔀 `scm` — source-control actions: `open_pull_request`, `checkout_branch`, `merge`, `review`, `tag_release` (one PR per changed repo).
- 🧭 `condition` — a boolean gate / multi-branch router over upstream outputs; skips branches that don't apply.
- 💬 `message` — post a notification or add a comment to the ticket.
- 🌐 `http` / `graphql` — call an external API as a first-class step.
- 📦 `workflow` — reference a reusable sub-workflow, inlined into the graph.

See the [Workflows guide](./docs/workflows.md) for the full contract, plus retries, timeouts, `continueOnError`, matrix fan-out, and loops.

## Architecture

Everything integratable sits behind a category adapter interface, so new tools are purely additive — implement the interface, register it, and the engine and UI light up.

| Category | Interface (`*-core`) | In scope | On the roadmap |
| --- | --- | --- | --- |
| `harness` | `@orion/harness-core` | **codex** (OpenAI / DeepSeek / any OpenAI-compatible) | claude, opencode |
| `scm` | `@orion/scm-core` | **github** | bitbucket, gitlab |
| `board` | `@orion/board-core` | **native** board + sync from **linear, jira, trello** | asana, github projects |
| `communication` | `@orion/communication-core` | **webhook, slack** (Slack/Discord-compatible) | discord, telegram |

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

```
apps/
  orchestrator   Express: REST + SSE, hosts the engine, adapters, RAG and MCP
  web            React 19 + shadcn/ui Kanban board & visual workflow builder (Vite)
packages/
  shared/models          domain types
  shared/adapter-kit     shared provider registry
  core/config            YAML + zod config loader, command templates, skills, DAG validation
  core/workflow-engine   deterministic DAG scheduler (no AI, no DB)
  core/rag               codebase indexing + embedding pipeline primitives
  data/db                Drizzle schema, client, repositories, migrations (Postgres + PGlite)
  adapters/<category>/*  category interfaces (core) and implementations
```

For the full picture — worktree isolation, the event bus, node executors, and how a run flows end to end — see the [Architecture guide](./docs/architecture.md).

## Getting Started

The fastest path is Docker:

```bash
cp .env.example .env   # optional: set CODEX_API_KEY / CODEX_BASE_URL / GITHUB_TOKEN
docker compose up -d --build
```

| Service | URL | Notes |
| --- | --- | --- |
| Web (board) | `http://<host>:8401` | nginx serves the UI and proxies `/api` |
| Orchestrator | `http://<host>:8400` | REST + SSE API |
| Postgres | `<host>:8402` | user/pass/db: `orion` |

Prefer running without Docker, or want the zero-setup embedded PGlite database? See the [Getting Started guide](./docs/getting-started.md), which covers local development, the embedded database, and every environment variable.

## Configuring a Repository

Add `.orion/config.yaml` (and any command templates under `.orion/commands/`) to the repository a project tracks. See [`examples/orion-config`](./examples/orion-config) for a complete example, and the [Configuration guide](./docs/configuration.md) for the full schema.

Config is validated with Zod on load — unique node IDs, valid provider and swimlane references, no dangling dependencies, and **cycle detection** so a bad graph never runs.

## Common Tasks

```bash
npx nx run-many -t typecheck lint test   # verify the workspace
npx nx run @orion/db:db:generate         # regenerate migrations after schema changes
```

See [AGENTS.md](./AGENTS.md) for the full testing matrix (unit, orchestrator integration, and Playwright E2E).

## Roadmap

- **Harnesses** — Claude, opencode alongside Codex
- **Source control** — GitLab, Bitbucket
- **Boards** — Asana, GitHub Projects alongside Linear, Jira, Trello sync
- **Communication** — Discord, Telegram alongside webhook and Slack

New providers are additive: implement a category interface, register it, done.

## License

[MIT](./LICENSE)

<div align="center">
<br/>
<img src="assets/mark.png" alt="Orion" width="64" />
<br/>
<sub><strong>Orion</strong> — the workflow owns the process, the agent owns the reasoning.</sub>
</div>
