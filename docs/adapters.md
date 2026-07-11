# Adapters

Every external integration in Orion sits behind a **category adapter**. Each category defines a
`*-core` interface package, and one or more concrete implementations register themselves with a
shared `ProviderRegistry` (`@orion/adapter-kit`) under a string `key`. The engine resolves
providers by key at runtime, so adding a new one is purely additive: implement the interface,
register it, done.

| Category | Interface | Implementations |
| --- | --- | --- |
| [Harness](#harness) | `@orion/harness-core` | `codex` |
| [SCM](#scm-source-control) | `@orion/scm-core` | `github` |
| [Board](#board) | `@orion/board-core` | `native` (+ sync clients for `linear`, `jira`, `trello`) |
| [Communication](#communication) | `@orion/communication-core` | `webhook`, `slack` |

## Harness

An AI harness runs an agent turn inside the worktree. The interface (`AgentProvider`) exposes a
streamed `run` that yields messages, tool-call items, and usage, plus thread continuation so a
[looping node](./workflows.md#loops) can keep context across iterations.

### `codex`

Wraps [`@openai/codex-sdk`](https://www.npmjs.com/package/@openai/codex-sdk). It starts or
resumes a Codex thread in the run's worktree, translates Orion's MCP server configs into the
SDK's format, and — for non-OpenAI providers such as DeepSeek — switches to the Chat Completions
wire protocol.

Point it at any OpenAI-compatible endpoint per node with `baseUrl`, or globally with the
`CODEX_BASE_URL` environment variable.

```yaml
- id: implement
  type: agent
  provider: codex
  model: gpt-5-codex
  baseUrl: https://api.deepseek.com   # optional
```

| Config / env | Purpose |
| --- | --- |
| `CODEX_API_KEY` | API key for the underlying provider (OpenAI, DeepSeek, …) |
| `CODEX_BASE_URL` | Base URL override for a non-OpenAI provider |
| node `model` / `baseUrl` | Per-node overrides |

> **Roadmap:** `claude` and `opencode` harnesses.

## SCM (source control)

The SCM adapter (`ScmProvider`) clones and worktrees repositories, commits and pushes changes,
and opens/merges pull requests. It's what powers [worktree
isolation](./architecture.md#worktree-isolation) and the [`scm` node](./workflows.md#scm).

### `github`

A full GitHub adapter. It clones repos, creates git worktrees, commits and pushes, and opens
PRs via the GitHub REST API — including finding existing PRs, requesting reviewers, listing
reviews, merging, and creating tags/releases. GitHub Enterprise Server is supported via an API
base URL override.

| Config / env | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Personal access token for push, PRs, merges, and releases |
| `apiBaseUrl` (option) | GitHub Enterprise Server base URL |

`scm` node actions: `checkout_branch`, `open_pull_request`, `merge`, `review`, `tag_release`.

> **Roadmap:** `bitbucket` and `gitlab`.

## Board

The board adapter (`BoardProvider`) is the source of truth for the Kanban board — swimlanes,
tickets, labels, and relations.

### `native` (default)

The default board, backed by Postgres/PGlite via the ticket and label repositories. It powers
the drag-and-drop Kanban board, swimlane-based workflow triggers, ticket relations, and labels.
This is the provider the engine reads and writes as runs move tickets between swimlanes.

### Remote board sync — `linear`, `jira`, `trello`

Linear, Jira, and Trello are **sync clients** (they implement the `RemoteBoardClient` contract,
not `BoardProvider`). Orion's board-sync engine pulls issues from the external tool into the
native board and can push status changes and comments back, on a configurable interval
(`ORION_BOARD_SYNC_INTERVAL_MS`, default 10 minutes, overridable per connection). See
[Integrations → Board sync](./integrations.md#board-sync) for setup.

| Provider | Credentials |
| --- | --- |
| `linear` | Linear API key; a team as the container |
| `jira` | Jira Cloud base URL, Atlassian email, and an API token (HTTP Basic) |
| `trello` | Trello developer key and a user token |

Credentials are stored per project in the `board_connections` table, encrypted at rest when
`PROVIDER_ENCRYPTION_SALT` is set.

> **Roadmap:** `asana` and `github projects`.

## Communication

Communication adapters (`Notifier`) deliver outbound notifications — from the
[`message` node](./workflows.md#message) and from run-lifecycle events (approval needed,
completed, failed).

### `webhook` (default) and `slack`

The webhook notifier POSTs a JSON payload to an incoming webhook URL. The payload includes a
ready-to-render `text`/`content` string (compatible with Slack and Discord) plus structured
`title`, `body`, `level`, and `url` fields for custom consumers. The `slack` variant is the same
notifier registered under a distinct key so `message` nodes can target it explicitly.

| Env | Purpose |
| --- | --- |
| `ORION_NOTIFY_WEBHOOK_URL` | Default webhook for run-lifecycle notifications |
| `ORION_SLACK_WEBHOOK_URL` | Slack incoming webhook; registers the `slack` notifier |

> **Roadmap:** `discord` and `telegram`.

## Writing a new adapter

1. Depend on the category's `*-core` interface package.
2. Implement the interface and expose a unique `key`.
3. Register your provider with the category registry in the orchestrator's container.

Because the engine resolves providers by key and validates references at config-load time, the
rest of the system — and the UI — pick up the new provider automatically.

## Related reading

- [Architecture](./architecture.md) — the adapter model in context.
- [Integrations](./integrations.md) — board sync, MCP, RAG, chat, and schedules.
- [Configuration](./configuration.md) — where providers are referenced in `.orion/config.yaml`.
