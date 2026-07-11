# Integrations

Beyond the core workflow engine, Orion ships several capabilities that make agents more capable
and the board more connected: codebase-aware retrieval, Model Context Protocol servers, an
interactive chat, cron schedules, and two-way board sync.

## Codebase RAG

Orion indexes your repository and exposes **semantic search** to agents, so they ground their
reasoning in your actual code rather than guessing.

**How it works.** The `@orion/rag` package provides a dependency-free pipeline:

1. **Walk** the repo, skipping vendored and build directories and honoring size/count limits.
2. **Chunk** each file into overlapping line windows.
3. **Embed** each chunk. Two providers are available: a deterministic offline
   `LocalEmbeddingProvider` (default/fallback) and an `OpenAiEmbeddingProvider`
   (`text-embedding-3-small`) when configured.
4. **Store** the chunks and their vectors in the database.
5. **Search** by embedding the query and ranking chunks by cosine similarity.

**Using it.** Trigger and monitor indexing from the web app's **Codebase** page, or over the
API:

```http
GET  /api/projects/:id/index                 # index status
POST /api/projects/:id/index                 # (re)build the index
POST /api/projects/:id/search { "query": "where is auth handled", "topK": 8 }
```

Agents reach the index through the auto-injected [codebase MCP server](#mcp-servers) rather than
calling the API directly.

## MCP servers

Orion speaks the [Model Context Protocol](https://modelcontextprotocol.io) both ways.

### Servers Orion hosts

The orchestrator exposes SSE MCP servers that it **auto-injects** into agent runs so agents can
query Orion itself:

| Endpoint | Tools |
| --- | --- |
| `/mcp/codebase?projectId=…` | `list_projects`, `search_code`, `index_status` |
| `/mcp/tickets?projectId=…` | `list_projects`, `list_tickets`, `get_ticket`, `create_ticket`, `update_ticket`, `move_ticket`, `list_labels` |

The codebase server is injected automatically unless `ORION_CODEBASE_MCP` is `false`. The
self-link URLs are built from `ORION_PUBLIC_URL`.

### Servers you attach

Give agents access to external MCP servers by declaring them in `.orion/config.yaml` — globally
under `mcpServers`, or per node. Each server is either stdio (`command` + `args` + `env`) or
HTTP (`url` + optional `bearerToken`):

```yaml
mcpServers:
  context7:
    command: npx
    args: [-y, '@upstash/context7-mcp']

workflow:
  nodes:
    - id: implement
      type: agent
      provider: codex
      mcpServers:                 # merged over the global set; same name overrides
        github:
          command: npx
          args: [-y, '@modelcontextprotocol/server-github']
          env:
            GITHUB_PERSONAL_ACCESS_TOKEN: ${GITHUB_TOKEN}
```

You can also register reusable MCP servers (with optional OAuth) from the web app's **MCP**
page; these are available to schedules and agents. See the [API Reference](./api.md#mcp-servers).

## Chat

The **Chat** page is a direct conversation with an agent, scoped to a project and streamed token
by token over SSE. Beyond free-form Q&A, Orion can **route** a natural-language request to the
right action — either answering in chat or kicking off a workflow run — via
`POST /api/projects/:id/route`.

## Schedules

Run agents on a **cron schedule** — nightly dependency bumps, a recurring triage pass, a weekly
report. A schedule carries its own instruction plus optional skills and MCP servers, and the
orchestrator's poller fires due schedules automatically. Manage them from the **Schedule** page
or the API:

```http
GET  /api/projects/:id/schedules
POST /api/projects/:id/schedules { "name": "nightly-deps", "cron": "0 3 * * *", "instruction": "…" }
POST /api/schedules/:id/fire     # run one now
```

## Board sync

Connect a project's board to **Linear**, **Jira**, or **Trello** to pull issues into Orion's
native board and push status changes and comments back. The sync heartbeat runs on
`ORION_BOARD_SYNC_INTERVAL_MS` (default 10 minutes; a connection can override its own cadence).

Configure a connection from the project's board settings or over the API — including the
provider, credentials, the remote container (team/project/board), a state-to-swimlane map, and
the sync direction:

```http
PUT  /api/projects/:id/board-connection { "provider": "linear", "apiKey": "…", "teamId": "…", … }
GET  /api/projects/:id/board-connection/containers   # list remote teams/projects/boards
GET  /api/projects/:id/board-connection/states?teamId=…
POST /api/projects/:id/board-connection/sync         # sync now
```

Credentials are encrypted at rest when `PROVIDER_ENCRYPTION_SALT` is set. See the
[Adapters guide](./adapters.md#remote-board-sync--linear-jira-trello) for the credentials each
provider needs.

## Analytics & evaluations

Two more views round out observability:

- **Analytics** — success rates, token and cost totals, and trends over time, filterable by
  project and window (`GET /api/analytics`).
- **Evaluations** — record and aggregate quality assessments (rating, score, labels, comments)
  against runs and nodes, producing per-agent scorecards (`/api/evaluations/*`,
  `/api/runs/:id/evaluations`).

## Related reading

- [Adapters](./adapters.md) — the providers behind board sync and notifications.
- [Configuration](./configuration.md) — declaring MCP servers in `.orion/config.yaml`.
- [API Reference](./api.md) — the full endpoint list.
