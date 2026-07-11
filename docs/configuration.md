# Configuration

A project is configured by a single file — `.orion/config.yaml` — committed to the repository
it tracks (at the source root, or the config root for a `workspace` project). It defines the
board swimlanes, the workflow DAG, reusable sub-workflows, and shared MCP servers. Command
templates live alongside it under `.orion/commands/`.

The config is parsed and validated with [Zod](https://zod.dev) on load. See
[`examples/orion-config`](../examples/orion-config) for a complete, runnable example.

> **Editing options** — You can edit the raw YAML directly, use the in-app form editor, or use
> the visual [workflow builder](./workflows.md#the-visual-builder). All three round-trip to the
> same file.

## Top-level shape

```yaml
project:            # required — identity and git defaults
  name: example-service
  defaultBranch: main
  branchFormat: "orion/$TICKET_SLUG-$RUN_ID_SHORT-$RANDOM"   # optional

mcpServers:         # optional — MCP servers shared by every agent node
  context7:
    command: npx
    args: [-y, '@upstash/context7-mcp']

board:              # required — the Kanban swimlanes
  swimlanes: [backlog, investigating, in_progress, review, done]

workflows:          # optional — named, reusable sub-workflows
  qa:
    name: qa
    nodes: [ ... ]

workflow:           # required — the primary DAG
  name: default
  nodes: [ ... ]
  budget:           # optional — hard limits for the whole run
    maxTokens: 2000000
    maxCostUsd: 25
```

### `project`

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | Project name (the first repo's name for a single-repo project) |
| `defaultBranch` | no (default `main`) | Base branch runs branch from and target for PRs |
| `branchFormat` | no | Template for run branch names (see [branch templates](#branch-name-templates)) |

### `board`

| Field | Required | Description |
| --- | --- | --- |
| `swimlanes` | yes | Ordered list of board swimlanes; at least one |

> **Legacy compatibility** — `columns` (board) and `column` (node) are accepted as aliases for
> `swimlanes` and `swimlane` and normalized on load. New configs should use `swimlanes`.

### `mcpServers`

A map of MCP servers made available to **every** agent node. Each entry is either a stdio
server (`command` + `args` + `env`) or an HTTP server (`url` + optional `bearerToken`). Nodes
can add or override entries with their own `mcpServers`. See
[Integrations → MCP servers](./integrations.md#mcp-servers).

```yaml
mcpServers:
  context7:                     # stdio server
    command: npx
    args: [-y, '@upstash/context7-mcp']
  internal-api:                 # http server
    url: https://mcp.internal.example.com/sse
    bearerToken: ${INTERNAL_MCP_TOKEN}
```

### `workflows` (sub-workflows)

A map of named, reusable workflows. Reference one from the primary workflow with a `workflow`
node; it is **inlined** (flattened) into the parent graph at load time. See
[Workflows → Sub-workflows](./workflows.md#sub-workflows).

### `workflow`

The primary DAG.

| Field | Required | Description |
| --- | --- | --- |
| `name` | no (default `default`) | Workflow name (exposed as `$WORKFLOW_ID` context) |
| `nodes` | yes | The list of nodes; at least one |
| `budget` | no | `maxTokens` and/or `maxCostUsd` — the run fails if either is exceeded |

Node fields are documented in the [Workflows guide](./workflows.md#node-reference). Every node
has an `id`, a `type`, optional `dependsOn` (a list of predecessor node IDs), and an optional
`swimlane` the ticket moves into while the node runs.

## Command templates

Agent nodes point `instructions` at a markdown file (relative to `.orion/`) — for example
`instructions: commands/investigate.md`. You can also inline the instructions as a string. The
engine renders the template **fresh for every node**, substituting variables.

Two substitution styles are supported:

- `$VARIABLE` / `${VARIABLE}` — uppercase scalar variables.
- `{{ … }}` — references into upstream node outputs and matrix context.

### Scalar variables (`$VARIABLE`)

| Variable | Resolves to |
| --- | --- |
| `$ARGUMENTS` | The ticket title + description |
| `$TICKET_TITLE` | The ticket title |
| `$REPOSITORY` | The project/repo name |
| `$REPOSITORIES` | Comma-separated names of all repos in a workspace |
| `$BRANCH` | The run branch name |
| `$BASE_BRANCH` | The base branch (`project.defaultBranch`) |
| `$WORKFLOW_ID` | The workflow run identifier |

Inside a **matrix** node, additional variables are available per item — `$MATRIX_ITEM`,
`$MATRIX_INDEX`, `$MATRIX_TOTAL`, and `$<AS>` (the item under its `as` name, uppercased). See
[Workflows → Matrix fan-out](./workflows.md#matrix-fan-out).

### Output references (`{{ … }}`)

Reference the output of an upstream node (by its `id`) to pass data downstream:

| Pattern | Meaning |
| --- | --- |
| `{{ nodes.<id> }}` | The full output of an upstream node (JSON if an object) |
| `{{ nodes.<id>.<path> }}` | A dot-path into an upstream node's output |
| `{{ matrix.item }}` / `{{ matrix.item.<path> }}` | The current matrix item |
| `{{ matrix.<as> }}` | The current matrix item under its `as` name |
| `{{ matrix.index }}` / `{{ matrix.total }}` | The current matrix index / total item count |

For example, an `implement` node can read the investigation's conclusion:

```markdown
Here is what the investigation found:

{{ nodes.investigate.finalResponse }}

Implement the fix on branch $BRANCH.
```

### Branch name templates

`project.branchFormat` controls the name of the branch each run creates. Default:
`orion/$TICKET_SLUG-$RUN_ID_SHORT-$RANDOM`.

| Variable | Resolves to |
| --- | --- |
| `$TICKET_ID` | The ticket identifier |
| `$TICKET_SLUG` | A slugified ticket title |
| `$WORKFLOW_NAME` | The workflow name |
| `$RUN_ID` / `$RUN_ID_SHORT` | The full / shortened run id |
| `$RANDOM` | A short random suffix (avoids collisions) |

## Validation

On load, Orion validates both the shape (Zod) and the semantics of the config. A config is
rejected if any of the following hold:

- Duplicate node IDs (within the workflow or a sub-workflow).
- A node references a `swimlane` that isn't in the board.
- A `dependsOn` entry references a node that doesn't exist.
- Type-specific requirements are unmet — e.g. an `agent` without a `provider`, a `shell`
  without a `script`, an `scm` without an `action`, a `condition` with an unparsable
  expression, an `http` without a `url`, a `graphql` without a `url` and `query`.
- `retries` / `retryDelayMs` / `timeoutMs` are set on a node type that doesn't support them
  (only `agent`, `http`, and `graphql` do).
- `loop` is on a non-`agent` node, or `matrix` is on anything but `agent`/`shell`, or `matrix`
  and `loop` are combined.
- A `workflow` node references a sub-workflow that doesn't exist, or sub-workflow references
  form a cycle.
- The flattened DAG has a dangling dependency or **contains a cycle**.

Because validation runs before scheduling, a bad graph never runs.

## Secrets

Fields such as node `token` values, provider API keys, and board-connection credentials are
encrypted at rest with AES-256-GCM when `PROVIDER_ENCRYPTION_SALT` is set (see
[Getting Started](./getting-started.md#environment-variables)). In templates and MCP configs,
reference environment variables with `${VAR}` so secrets stay out of the committed YAML.

## Related reading

- [Workflows](./workflows.md) — the full node reference and execution policy.
- [Skills](./skills.md) — attaching reusable instruction bundles to agent nodes.
- [Integrations](./integrations.md) — MCP servers, RAG, and board sync.
