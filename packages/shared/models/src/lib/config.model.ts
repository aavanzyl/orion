/**
 * Types describing the per-repository configuration file (`.orion/config.yaml`).
 * The config is intentionally declarative: it describes the board, the agents,
 * and the workflow DAG. It contains no execution logic.
 */

export type WorkflowNodeType =
  | 'agent'
  | 'approval'
  | 'scm'
  | 'shell'
  | 'workflow'
  | 'message'
  | 'condition'
  | 'http'
  | 'graphql';

/** Severity of an outbound notification (mirrors the communication adapter). */
export type NotificationLevel = 'info' | 'warn' | 'error';

/**
 * Where a `message` node delivers its rendered body: `notify` sends it through
 * the configured notification providers (Slack, webhook), while `comment` posts
 * it on the run's ticket in the tracker.
 */
export type MessageTarget = 'notify' | 'comment';

/** HTTP verbs supported by an `http` node. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

/**
 * Definition of a single Model Context Protocol (MCP) server made available to
 * an agent's harness. Servers are keyed by a unique name in the map they live
 * in. Provide either a `command` (stdio transport) or a `url` (streamable HTTP
 * transport).
 */
export interface McpServerConfig {
  /** Executable to launch for a stdio MCP server, e.g. `npx`. */
  command?: string;
  /** Arguments passed to `command`. */
  args?: string[];
  /** Environment variables provided to the server process. */
  env?: Record<string, string>;
  /** URL of a streamable HTTP MCP server (alternative to `command`). */
  url?: string;
  /** Bearer token used to authenticate against an HTTP MCP server. */
  bearerToken?: string;
}

/** A named collection of MCP servers, keyed by unique server name. */
export type McpServerMap = Record<string, McpServerConfig>;



/**
 * A configurable issue type that maps to a workflow. "epic" is always available
 * regardless of configuration, so it does not need to be listed explicitly.
 */
export interface IssueTypeConfig {
  /** Stable key, e.g. `feature`, `bug`. Must be unique across issue types. */
  name: string;
  /** Human-readable label, e.g. `Feature`, `Bug`. */
  label: string;
  /**
   * Workflow name this issue type triggers. References either the top-level
   * `workflow.name` or an entry in the `workflows` map.
   */
  workflow: string;
  /** Optional icon identifier (e.g. Lucide icon name). */
  icon?: string;
  /** Optional hex color for badges / indicators. */
  color?: string;
}

export interface BoardConfig {
  /** Ordered swimlane keys that make up the Kanban board. */
  swimlanes: string[];
  /** Swimlane that auto-triggers a workflow run when a ticket is moved into it and has no prior runs. */
  triggerSwimlane?: string;
}

/**
 * Makes an `agent` node iterate: the engine re-runs the node's executor until
 * the `until` sentinel appears in the iteration's stringified output or
 * `maxIterations` is reached. Only valid on `agent` nodes.
 */
export interface LoopConfig {
  /** Maximum iterations before the node fails (integer >= 1). */
  maxIterations: number;
  /** Substring that, when found in an iteration's output, stops the loop. */
  until: string;
  /** Start a fresh harness thread each iteration instead of accumulating. */
  freshContext?: boolean;
}

/**
 * Expands an `agent` or `shell` node into N concurrent executions, one per
 * item. The item is injected into the node's prompt/script and the node's
 * aggregated output is the array of per-item outputs.
 */
export interface MatrixConfig {
  /** A literal array of items, or a node-output reference string like "nodes.plan.data.files". */
  items: unknown[] | string;
  /**
   * Friendly name the current item is exposed under, so templates can read it
   * as `$<AS>` / `${<AS>}` and `{{ matrix.<as> }}` instead of the generic
   * `$MATRIX_ITEM`. Defaults to `item` (i.e. `$ITEM` and `{{ matrix.item }}`).
   * Must be a simple identifier (letters, digits, underscore).
   */
  as?: string;
  /**
   * Maximum number of items to execute concurrently. Items beyond this run in
   * subsequent waves. Defaults to running every item at once (unbounded).
   */
  maxParallel?: number;
}

/**
 * A single branch in a multi-branch `condition` node. The first branch whose
 * `expression` evaluates truthy is taken; the last branch may omit `expression`
 * to serve as the `else` (taken when no other branch matched). Each branch may
 * name a `target` downstream node key that it routes into.
 */
export interface ConditionBranch {
  expression?: string;
  target?: string;
}

export interface WorkflowNodeConfig {
  id: string;
  type: WorkflowNodeType;
  /**
   * Harness adapter key, e.g. `codex`. Required for `agent` nodes.
   */
  provider?: string;
  /**
   * Model identifier passed to the harness (e.g. `gpt-5-codex`).
   * Only meaningful on `agent` nodes.
   */
  model?: string;
  /**
   * Optional OpenAI-compatible base URL (e.g. a DeepSeek endpoint).
   * Only meaningful on `agent` nodes.
   */
  baseUrl?: string;
  /**
   * Instructions template for the agent. Can be either:
   * - A path relative to `.orion/` pointing to a markdown command template file
   *   (e.g. `commands/implement.md`), which will be loaded and rendered.
   * - Inline multi-line text that will be rendered directly as the agent prompt.
   *
   * Supports `$VARIABLE` and `{{ nodes.<id>.<path> }}` template substitution.
   * Only meaningful on `agent` nodes.
   */
  instructions?: string;
  /**
   * Names of skills available to this agent node. Each is materialized into
   * the run's worktree so the harness can discover it. Names resolve against the
   * project's skill catalog (built-in defaults + skills under `.orion/skills/`).
   */
  skills?: string[];
  /**
   * MCP servers unique to this agent node, keyed by name. These are merged with
   * any project-wide `mcpServers`; on a name conflict the node's definition wins.
   */
  mcpServers?: McpServerMap;
  /** Free-form provider configuration overrides (for `agent` nodes). */
  config?: Record<string, unknown>;
  /**
   * @deprecated Use `instructions` instead. Command template path relative to
   * `.orion/` (for `agent` nodes). Kept for backward compatibility; the executor
   * falls back to this only when `instructions` is absent.
   */
  command?: string;
  /**
   * @deprecated Use `instructions` instead. Inline prompt template (supports
   * $VARIABLE substitution). Kept for backward compatibility; the executor falls
   * back to this only when `instructions` is absent.
   */
  prompt?: string;
  /** Name of the sub-workflow to inline (for `workflow` nodes). */
  workflow?: string;
  /** Action name for `scm` nodes, e.g. `open_pull_request`. */
  action?: string;
  /**
   * When true, an `scm` `open_pull_request` node runs an agent to draft the PR
   * title and description from the run's changes instead of using the static
   * `config.title` / `config.body`. Requires a `provider` (harness key).
   */
  agentGenerated?: boolean;
  /** Shell command for `shell` nodes. */
  script?: string;
  /**
   * Delivery target for a `message` node: `notify` sends the rendered body
   * through the configured notification providers, `comment` posts it on the
   * run's ticket. Default `notify`.
   */
  messageTarget?: MessageTarget;
  /**
   * Message template for `message` nodes. Supports `$VARIABLE` and
   * `{{ nodes.<id>.<path> }}` substitution against upstream node outputs. When
   * `agentGenerated` is set, this is treated as optional guidance for the agent
   * that drafts the message instead of the literal body.
   */
  message?: string;
  /** Severity for `message` notify-target nodes; also decorates the message. Default `info`. */
  level?: NotificationLevel;
  /**
   * Boolean expression for a `condition` node. When it evaluates false the node
   * — and its exclusive downstream branch — is skipped. When `branches` is also
   * present, this field is ignored; use `branches` for multi-way routing.
   */
  condition?: string;
  /**
   * Ordered list of if/else-if/else branches for a `condition` node. Each
   * branch has an optional `expression` (absent for the `else` case) and an
   * optional `target` downstream node key. The engine evaluates expressions in
   * order and takes the first truthy branch, skipping the targets of all other
   * branches.
   */
  branches?: ConditionBranch[];
  /** Request URL for `http` nodes. Supports template substitution. */
  url?: string;
  /** HTTP method for `http` nodes. Default `GET`. */
  method?: HttpMethod;
  /** Extra request headers for `http`/`graphql` nodes. Values support template substitution. */
  headers?: Record<string, string>;
  /** Request body for `http` nodes (sent for non-GET/HEAD). Supports substitution. */
  body?: string;
  /** GraphQL query/mutation document for `graphql` nodes. Supports substitution. */
  query?: string;
  /**
   * GraphQL variables for `graphql` nodes, as a JSON object string. Supports
   * template substitution before being parsed.
   */
  variables?: string;
  /**
   * Bearer token for `http`/`graphql` nodes. Stored encrypted at rest (prefixed
   * `aes256:`) when a server encryption salt is configured, and decrypted only
   * in-process at execution time. Sent as `Authorization: Bearer <token>`.
   */
  token?: string;
  /** Ids of nodes that must complete before this node becomes ready. */
  dependsOn?: string[];
  /** Board swimlane the ticket moves to while this node is active. */
  swimlane?: string;
  /**
   * Extra attempts after the first failure before the run fails (default 0).
   * Only honored on `agent`, `http` and `graphql` nodes.
   */
  retries?: number;
  /** Delay between retry attempts, in milliseconds (default 0). `agent`/`http`/`graphql` only. */
  retryDelayMs?: number;
  /** Abort the node after this many milliseconds. `agent`/`http`/`graphql` only. */
  timeoutMs?: number;
  /**
   * When true, a failure of this node (after exhausting retries) is advisory:
   * the node is marked `skipped`, the run keeps going, and dependents proceed.
   * Useful for non-blocking gates like advisory linters.
   */
  continueOnError?: boolean;
  /**
   * When this node fails, reset the named target node (and all transitive
   * downstream nodes) back to `pending` so they re-execute. The current node's
   * error and output are stored on the target node's `input` as
   * `{ onFailureFrom, error, output }` — accessible in agent templates via
   * `{{ input.error }}`, `{{ input.onFailureFrom }}`, etc.
   */
  onFailureTransitionTo?: string;
  /**
   * When set, re-run this node's executor iteratively until a stop condition is
   * met. Only valid on `agent` nodes.
   */
  loop?: LoopConfig;
  /**
   * @deprecated Matrix fan-out has been removed. The MatrixConfig type is kept
   * for backward compatibility but this field is no longer used.
   */
  // matrix?: MatrixConfig;
}

export interface BudgetConfig {
  maxTokens?: number;
  maxCostUsd?: number;
}

export interface WorkflowConfig {
  name: string;
  nodes: WorkflowNodeConfig[];
  budget?: BudgetConfig;
}

/**
 * A lean, UI-facing summary of a bundled workflow template. The full template
 * (including its DAG and suggested agents/swimlanes) lives in the config package;
 * the web only needs enough to render a gallery and picker.
 */
export interface WorkflowTemplateSummary {
  /** Stable kebab-case identifier used to fetch the full template. */
  name: string;
  /** Human-readable title. */
  title: string;
  /** One or two sentences on when to reach for this template. */
  description: string;
  /** Optional free-form tags for grouping/filtering. */
  tags?: string[];
  /** Number of nodes in the template's workflow DAG. */
  nodeCount: number;
  /** Distinct node types the workflow uses, e.g. `['agent', 'shell', 'scm']`. */
  nodeTypes: string[];
}

export interface ProjectConfig {
  project: {
    name: string;
    defaultBranch: string;
    /**
     * Template for branch names created during workflow runs. Supports
     * `$TICKET_ID`, `$TICKET_SLUG`, `$WORKFLOW_NAME`, `$RUN_ID`.
     * Default: `orion/$TICKET_SLUG-$RUN_ID_SHORT-$RANDOM`.
     */
    branchFormat?: string;
  };
  /**
   * MCP servers shared by every agent node, keyed by name. Individual agent
   * nodes may add their own via `WorkflowNodeConfig.mcpServers` or override an
   * entry of the same name.
   */
  mcpServers?: McpServerMap;
  /** Named reusable sub-workflows, inlined by `workflow` nodes. */
  workflows?: Record<string, WorkflowConfig>;
  /**
   * Configurable issue types that map to workflows. The type name `epic` is
   * always implicitly available regardless of configuration. When omitted the
   * built-in defaults (feature, bug, issue, hotfix) apply.
   */
  issueTypes?: IssueTypeConfig[];
  board: BoardConfig;
  workflow: WorkflowConfig;
}
