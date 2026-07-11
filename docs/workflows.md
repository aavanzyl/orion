# Workflows

A workflow is a **directed acyclic graph (DAG)** of nodes. The
[engine](./architecture.md#workflow-engine-orionworkflow-engine) schedules each node the
moment its dependencies are satisfied, runs independent branches in parallel, and pauses on
human approvals. This guide covers every node type and the execution policy that governs them.

## How scheduling works

The engine advances the run in **passes**. On each pass it:

1. Fails the run if any node has failed (unless that node opted into `continueOnError`).
2. Completes the run if every node is in a terminal state (`completed`, `skipped`, or
   `cancelled`).
3. Fails the run if the token or cost **budget** is exceeded.
4. Collects the outputs of finished nodes into a map, exposed to downstream nodes for data flow.
5. Finds every node whose `dependsOn` are all satisfied (`completed` or `skipped`) and runs
   them **concurrently**.

A node's `swimlane`, if set, is where the ticket moves on the board while that node runs.

## Node reference

Every node shares these fields:

| Field | Description |
| --- | --- |
| `id` | Unique identifier within the workflow (used in `dependsOn` and `{{ nodes.<id> }}`) |
| `type` | One of the nine node types below |
| `dependsOn` | List of predecessor node IDs that must finish first |
| `swimlane` | Board swimlane the ticket moves into while this node runs |

Nodes also share the [execution policy](#execution-policy) fields (`retries`, `timeoutMs`,
`continueOnError`, etc.), subject to per-type support.

### `agent`

An AI turn, driven by a rendered instruction template. Streams messages, tool calls, and usage
to the board.

```yaml
- id: implement
  type: agent
  provider: codex              # required — harness adapter key
  model: gpt-5-codex
  baseUrl: https://api.deepseek.com   # optional — any OpenAI-compatible endpoint
  instructions: commands/implement.md # template file (relative to .orion/) or inline string
  skills: [conventional-commits, test-driven-change]
  mcpServers:                  # optional — per-node MCP servers (merged with the global set)
    github:
      command: npx
      args: [-y, '@modelcontextprotocol/server-github']
  dependsOn: [investigate]
  swimlane: in_progress
```

| Field | Description |
| --- | --- |
| `provider` | Harness adapter key (e.g. `codex`) — **required** |
| `model` | Model id passed to the harness |
| `baseUrl` | OpenAI-compatible endpoint override |
| `instructions` | Command template file path or inline string ([templates](./configuration.md#command-templates)) |
| `skills` | Skill names to materialize into the worktree ([Skills](./skills.md)) |
| `mcpServers` | Per-node MCP servers, merged over the project-wide set ([Integrations](./integrations.md#mcp-servers)) |
| `config` | Provider-specific options passed through to the harness |

Agent nodes support [retries and timeouts](#execution-policy), [loops](#loops), and
[matrix fan-out](#matrix-fan-out). See the [Skills guide](./skills.md) for `skills`.

### `shell`

A deterministic script — no AI. Runs in the worktree; stdout/stderr are captured and streamed.

```yaml
- id: verify
  type: shell
  script: "npm test"
  dependsOn: [implement]
  swimlane: in_progress
```

Shell nodes support [matrix fan-out](#matrix-fan-out).

### `approval`

A human gate. The run pauses and the ticket parks in the node's swimlane until you approve it
from the board (or via the API), after which the engine resumes.

```yaml
- id: approval
  type: approval
  dependsOn: [verify]
  swimlane: review
```

### `scm`

Source-control actions. The GitHub adapter implements them; for a multi-repo workspace,
`open_pull_request` opens **one PR per changed repository**.

```yaml
- id: open_pr
  type: scm
  action: open_pull_request
  agentGenerated: true         # let an agent draft the PR title/body
  dependsOn: [approval]
  swimlane: done
```

Supported `action` values: `checkout_branch`, `open_pull_request`, `merge`, `review`,
`tag_release`.

### `condition`

A boolean gate or multi-branch router evaluated against upstream node outputs. When the
expression is false, the node and its exclusive downstream branch are **skipped** (the skip
cascades to dependents). Supports multi-branch `if / else-if / else` routing via `branches`.

```yaml
- id: needs_migration
  type: condition
  condition: "nodes.investigate.touchesSchema == true"
  dependsOn: [investigate]
```

Expressions are evaluated by a small, safe expression engine (no arbitrary code execution) and
can reference `nodes.<id>.<path>` values.

### `message`

Post an outbound notification or add a comment to the ticket.

```yaml
- id: announce
  type: message
  messageTarget: notify        # "notify" (via a notifier adapter) or "comment" (on the ticket)
  level: info                  # info | warn | error
  message: "Deploy of $TICKET_TITLE completed on $BRANCH"
  dependsOn: [open_pr]
```

### `http` / `graphql`

Call an external API as a first-class step. Both support [retries and timeouts](#execution-policy).

```yaml
- id: notify_deploy
  type: http
  method: POST                 # GET | POST | PUT | PATCH | DELETE | HEAD
  url: https://deploy.example.com/hooks/orion
  headers:
    Authorization: "Bearer ${DEPLOY_TOKEN}"
  body: '{"branch":"$BRANCH"}'
  dependsOn: [open_pr]

- id: fetch_status
  type: graphql
  url: https://api.example.com/graphql
  query: "query($n:Int!){ build(number:$n){ status } }"
  variables: '{"n": 42}'
  token: ${API_TOKEN}          # bearer token, encrypted at rest
```

### `workflow`

Reference a reusable sub-workflow. See [Sub-workflows](#sub-workflows).

## Execution policy

Nodes can opt into retries, timeouts, and non-blocking behavior.

```yaml
- id: implement
  type: agent
  provider: codex
  retries: 2          # up to 2 extra attempts after the first failure
  retryDelayMs: 5000  # wait 5s between attempts
  timeoutMs: 600000   # abort and fail if it runs longer than 10 minutes
```

| Field | Applies to | Effect |
| --- | --- | --- |
| `retries` | `agent`, `http`, `graphql` | Extra attempts after the first failure |
| `retryDelayMs` | `agent`, `http`, `graphql` | Pause between attempts |
| `timeoutMs` | `agent`, `http`, `graphql` | Abort the attempt (via an abort signal) and fail if exceeded; subject to the retry policy |
| `continueOnError` | any node | On failure (after retries), mark the node `skipped`, record the error, and let dependents proceed |

### `continueOnError`

Advisory steps can opt out of failing the run. The node is marked `skipped` if it fails, the
failure is recorded on the timeline, and dependents still proceed — perfect for non-blocking
gates like an advisory linter:

```yaml
- id: lint
  type: shell
  script: "npm run lint"
  continueOnError: true   # a failing lint won't block the PR
```

> Advisory skips do **not** cascade like condition skips — dependents run normally.

## Parallel fan-out

The engine schedules the DAG, not a list. Every node whose dependencies are satisfied in the
same pass runs **concurrently**, so independent branches (say `lint`, `typecheck`, and `test`)
execute in parallel and the run only advances once they all settle.

```yaml
- { id: lint,      type: shell, script: "npm run lint",      dependsOn: [implement] }
- { id: typecheck, type: shell, script: "npm run typecheck", dependsOn: [implement] }
- { id: test,      type: shell, script: "npm test",          dependsOn: [implement] }
- { id: approval,  type: approval, dependsOn: [lint, typecheck, test] }
```

## Matrix fan-out

A single `agent` or `shell` node can fan out into N concurrent executions — one per item. Items
come from a literal array or a reference into an upstream node's output. Each item flows through
the same retry/timeout machinery.

```yaml
- id: build_all
  type: shell
  matrix:
    items: [web, api, worker]     # or: "nodes.plan.packages" to read an upstream list
    as: package                   # exposes $PACKAGE and {{ matrix.package }}
    maxParallel: 2                # cap concurrent items (optional)
  script: "npm run build --workspace $PACKAGE"
```

Within a matrix node the template context includes `$MATRIX_ITEM`, `$MATRIX_INDEX`,
`$MATRIX_TOTAL`, and `$<AS>` (here `$PACKAGE`). The node's output is `{ items: [...] }` — the
per-item results. Matrix cannot be combined with `loop`.

## Loops

An `agent` node can re-run iteratively until its output contains a sentinel string or a maximum
iteration count is reached (which fails the node).

```yaml
- id: implement
  type: agent
  provider: codex
  instructions: commands/implement.md
  loop:
    maxIterations: 10
    until: ALL_TASKS_COMPLETE     # stop when the output contains this string
    freshContext: false           # false: keep the harness thread; true: start fresh each pass
```

Each iteration emits a `node.iteration` event. Only `agent` nodes may loop.

## Sub-workflows

Define reusable workflows under the top-level `workflows` map and reference them with a
`workflow` node. The referenced workflow is **inlined** into the parent graph at load time, so
the engine still schedules a single flat DAG (and still validates it for cycles).

```yaml
workflows:
  qa:
    name: qa
    nodes:
      - { id: lint, type: shell, script: "npm run lint" }
      - { id: test, type: shell, script: "npm test", dependsOn: [lint] }

workflow:
  name: default
  nodes:
    - { id: implement, type: agent, provider: codex, instructions: commands/implement.md }
    - { id: quality, type: workflow, workflow: qa, dependsOn: [implement] }
    - { id: approval, type: approval, dependsOn: [quality] }
```

## Budgets

Cap the total token and cost spend of a run. If either is exceeded, the run fails.

```yaml
workflow:
  name: default
  nodes: [ ... ]
  budget:
    maxTokens: 2000000
    maxCostUsd: 25
```

## Concurrency, retry & recovery

- **Bounded concurrency** — `ORION_MAX_CONCURRENT_RUNS` (default `3`, `0` = unlimited) caps how
  many runs execute at once. Start as many tickets as you like; anything over the limit is
  `queued` and launched automatically as slots free up.
- **Retrying a run** — A failed or cancelled run can be retried from the board. It resumes from
  the last successful node, preserving completed work and re-running everything else in a fresh
  worktree.
- **Crash recovery** — Because runs are event-sourced, a run left mid-flight by an orchestrator
  restart is automatically surfaced as failed on startup so you can retry it, instead of
  hanging forever.

## The visual builder

Prefer clicking to typing? The web app ships a visual workflow builder built on
[React Flow](https://reactflow.dev). Drag node types from the palette, wire dependencies (cycle
creation is blocked), edit properties in a side panel, auto-arrange by swimlane, and save — it
round-trips to the exact same `.orion/config.yaml` the engine consumes. A library of built-in
workflow templates gives you a starting point.

## Related reading

- [Configuration](./configuration.md) — the config schema and command templates.
- [Skills](./skills.md) — attaching instruction bundles to agent nodes.
- [Adapters](./adapters.md) — the harness, SCM, and communication providers nodes call.
