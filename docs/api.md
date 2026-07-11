# API Reference

The orchestrator exposes a REST + SSE API. Unless noted, all routes are prefixed with `/api`
and return the envelope `{ "data": …, "success": true }` (or `{ "success": false, "error": … }`
on failure). The default base URL is `http://localhost:3333` (`http://<host>:8400` under
Docker).

A liveness probe is available at `GET /health` (no `/api` prefix).

## Projects

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects` | List projects |
| `POST` | `/api/projects` | Create a project |
| `GET` | `/api/projects/:id` | Get a project |
| `PATCH` | `/api/projects/:id` | Update a project |
| `DELETE` | `/api/projects/:id` | Delete a project |
| `GET` | `/api/projects/:id/config` | Get the parsed config (board, workflow, sub-workflows) |
| `GET` | `/api/projects/:id/config/raw` | Get the raw config YAML |
| `PUT` | `/api/projects/:id/config/raw` | Save the raw config YAML |
| `POST` | `/api/config/encrypt-secret` | Encrypt a secret with the server salt |
| `GET` | `/api/projects/:id/board` | Get the full board (swimlanes + tickets) |

## Tickets, labels & relations

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/tickets` | List all tickets |
| `POST` | `/api/projects/:id/tickets` | Create a ticket |
| `GET` | `/api/tickets/:id/detail` | Ticket with labels, parent, sub-issues, relations |
| `PATCH` | `/api/tickets/:id` | Update a ticket |
| `POST` | `/api/tickets/:id/move` | Move a ticket to a swimlane |
| `POST` | `/api/tickets/:id/agent` | Assign the ticket's agent |
| `POST` | `/api/tickets/:id/relations` | Add a relation |
| `DELETE` | `/api/ticket-relations/:relationId` | Remove a relation |
| `GET` | `/api/labels` | List all labels |
| `GET` | `/api/projects/:id/labels` | List a project's labels |
| `POST` | `/api/projects/:id/labels` | Create a label |
| `DELETE` | `/api/labels/:id` | Delete a label |

## Runs

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/tickets/:id/run` | Start a workflow run for a ticket |
| `GET` | `/api/tickets/:id/runs` | List a ticket's runs |
| `GET` | `/api/runs` | List runs (filter by project, status, date, search) |
| `GET` | `/api/runs/:id` | Get a run and its nodes |
| `GET` | `/api/runs/:id/events` | List a run's events |
| `POST` | `/api/runs/:id/approve` | Approve a waiting node (`{ nodeKey }`) |
| `POST` | `/api/runs/:id/cancel` | Cancel a queued/in-flight run |
| `POST` | `/api/runs/:id/retry` | Retry a failed/cancelled run |

## Providers

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/providers` | List AI providers |
| `POST` | `/api/providers` | Create a provider (API key encrypted at rest) |
| `PATCH` | `/api/providers/:id` | Update a provider |
| `DELETE` | `/api/providers/:id` | Delete a provider |
| `GET` | `/api/providers/:id/api-key` | Get the decrypted API key |

## Commands

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/:id/commands` | List `.orion/` command files |
| `GET` | `/api/projects/:id/command?path=` | Read a command file |
| `PUT` | `/api/projects/:id/command` | Save a command file |

## Skills

Project-scoped:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/:id/skills` | List a project's skill catalog |
| `GET` | `/api/projects/:id/skills/:name` | Get a skill's detail |
| `GET` | `/api/projects/:id/skills/:name/references` | Find nodes referencing a skill |
| `POST` | `/api/projects/:id/skills` | Install a project skill |
| `PUT` | `/api/projects/:id/skills/:name` | Update a skill's metadata |
| `POST` | `/api/projects/:id/skills/:name/sync` | Sync a skill from its source |
| `DELETE` | `/api/projects/:id/skills/:name` | Uninstall a skill |

Global (parallel routes under `/api/skills`), plus `GET /api/skills/recommended`.

## Workflow templates

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/workflows/templates` | List built-in workflow templates |
| `GET` | `/api/workflows/templates/:name` | Get a template + rendered YAML + suggested swimlanes |

## Schedules

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/schedules` | List all schedules |
| `GET` | `/api/projects/:id/schedules` | List a project's schedules |
| `GET` | `/api/projects/:id/schedules/options` | Available skills/MCP servers for schedules |
| `POST` | `/api/projects/:id/schedules` | Create a schedule |
| `PATCH` | `/api/schedules/:id` | Update a schedule |
| `DELETE` | `/api/schedules/:id` | Delete a schedule |
| `POST` | `/api/schedules/:id/fire` | Fire a schedule now |

## MCP servers

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/mcp-servers` | List registered MCP servers |
| `POST` | `/api/mcp-servers` | Register a server (with optional OAuth) |
| `PATCH` | `/api/mcp-servers/:id` | Update a server |
| `DELETE` | `/api/mcp-servers/:id` | Delete a server |
| `POST` | `/api/mcp-servers/:id/oauth/start` | Begin an OAuth flow (returns an authorization URL) |
| `GET` | `/api/mcp-servers/oauth/callback` | OAuth callback |

Orion also **hosts** MCP servers (not under `/api`): `GET /mcp/codebase` and `GET /mcp/tickets`
(SSE) with matching `POST …/messages` handlers. See
[Integrations → MCP servers](./integrations.md#mcp-servers).

## Codebase (RAG)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/:id/index` | Get the codebase index status |
| `POST` | `/api/projects/:id/index` | Trigger a (re)index |
| `POST` | `/api/projects/:id/search` | Semantic search (`{ query, topK }`) |

## Chat

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/:id/conversations` | List conversations |
| `POST` | `/api/projects/:id/conversations` | Create a conversation |
| `GET` | `/api/conversations/:id` | Get a conversation and its messages |
| `POST` | `/api/conversations/:id/messages` | Send a message |
| `POST` | `/api/projects/:id/route` | Route a natural-language request to a workflow or chat |

## Board connections

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/:id/board-connection` | Get the connection |
| `PUT` | `/api/projects/:id/board-connection` | Create/update the connection |
| `DELETE` | `/api/projects/:id/board-connection` | Disconnect |
| `POST` | `/api/projects/:id/board-connection/sync` | Sync now |
| `GET` | `/api/projects/:id/board-connection/containers` | List remote teams/projects/boards |
| `GET` | `/api/projects/:id/board-connection/states?teamId=` | List remote column states |

## Analytics & evaluations

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/analytics?projectId=&days=` | Success rate, cost, and token trends |
| `GET` | `/api/evaluations/summary?projectId=&days=` | Evaluation summary |
| `GET` | `/api/projects/:id/evaluations` | List a project's evaluations |
| `GET` | `/api/runs/:id/evaluations` | List a run's evaluations |
| `POST` | `/api/runs/:id/evaluations` | Create an evaluation |
| `PATCH` | `/api/evaluations/:id` | Update an evaluation |
| `DELETE` | `/api/evaluations/:id` | Delete an evaluation |

## Settings & filesystem

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/settings` | Get app settings (branding, preferences) |
| `PUT` | `/api/settings` | Update app settings |
| `GET` | `/api/fs/dirs?path=` | Browse directories (project path picker) |

## Live streams (SSE)

Server-Sent Events endpoints replay recent history, then stream live. Consume them with the
native `EventSource` API.

| Path | Streams |
| --- | --- |
| `GET /api/runs/:id/stream` | Run and node lifecycle, agent messages/items/usage, ticket moves, logs |
| `GET /api/conversations/:id/stream` | Chat messages and deltas, items, usage, done/error |
| `GET /api/projects/:id/board/stream` | `ticket.updated` events for live board refresh |

## Related reading

- [Integrations](./integrations.md) — what many of these endpoints power.
- [Workflows](./workflows.md) — the runs these endpoints start and observe.
- [Architecture](./architecture.md) — how the API, engine, and adapters fit together.
