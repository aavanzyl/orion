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
  | 'notify'
  | 'comment'
  | 'condition'
  | 'http';

/** Severity of an outbound notification (mirrors the communication adapter). */
export type NotificationLevel = 'info' | 'warn' | 'error';

/** HTTP verbs supported by an `http` node. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export type StructuredFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface StructuredOutputConfig {
  /** Field name → expected JSON type. */
  schema: Record<string, StructuredFieldType>;
  /** Field names that must be present (subset of schema keys). */
  required?: string[];
}

/**
 * Codebase retrieval (RAG) settings for an agent node. When set, the top-K
 * codebase search results are prepended to the node's prompt as context.
 */
export interface RetrievalConfig {
  /** Query to search for; defaults to the ticket's title + description. */
  query?: string;
  /** Number of results to inject (default 8, max 20). */
  topK?: number;
}

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



export interface BoardConfig {
  /** Ordered swimlane keys that make up the Kanban board. */
  swimlanes: string[];
  /**
   * Map of swimlane key → workflow name(s). When a ticket is moved into
   * the swimlane, Orion automatically starts a run of the referenced workflow, so
   * the swimlane itself dictates the sequence of events. The name(s) resolve
   * against `workflows`, or the top-level `workflow` when one matches its name.
   * When an array is provided, the ticket's `workflowName` selects which trigger
   * fires; if the ticket has no `workflowName`, the first entry is used.
   */
  triggers?: Record<string, string | string[]>;
}

/**
 * Makes a node iterate: the engine re-runs the node's executor until the
 * `until` sentinel appears in the iteration's stringified output or
 * `maxIterations` is reached.
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
  /** Shell command for `shell` nodes. */
  script?: string;
  /**
   * Message template for `notify` and `comment` nodes. Supports `$VARIABLE` and
   * `{{ nodes.<id>.<path> }}` substitution against upstream node outputs.
   */
  message?: string;
  /** Severity for `notify` nodes; also decorates the message. Default `info`. */
  level?: NotificationLevel;
  /**
   * Boolean expression for a `condition` node (same grammar as `when`). When it
   * evaluates false the node — and its exclusive downstream branch — is skipped.
   */
  condition?: string;
  /** Request URL for `http` nodes. Supports template substitution. */
  url?: string;
  /** HTTP method for `http` nodes. Default `GET`. */
  method?: HttpMethod;
  /** Extra request headers for `http` nodes. Values support template substitution. */
  headers?: Record<string, string>;
  /** Request body for `http` nodes (sent for non-GET/HEAD). Supports substitution. */
  body?: string;
  /**
   * Bearer token for `http` nodes. Stored encrypted at rest (prefixed
   * `aes256:`) when a server encryption salt is configured, and decrypted only
   * in-process at execution time. Sent as `Authorization: Bearer <token>`.
   */
  token?: string;
  /** Ids of nodes that must complete before this node becomes ready. */
  dependsOn?: string[];
  /**
   * Condition evaluated against upstream node outputs; when false the node is
   * skipped and its exclusive downstream branch is skipped too.
   */
  when?: string;
  /** Board swimlane the ticket moves to while this node is active. */
  swimlane?: string;
  /** Extra attempts after the first failure before the run fails (default 0). */
  retries?: number;
  /** Delay between retry attempts, in milliseconds (default 0). */
  retryDelayMs?: number;
  /** Abort the node and treat it as failed after this many milliseconds. */
  timeoutMs?: number;
  /**
   * When true, a failure of this node (after exhausting retries) is advisory:
   * the node is marked `skipped`, the run keeps going, and dependents proceed.
   * Useful for non-blocking gates like advisory linters.
   */
  continueOnError?: boolean;
  /**
   * When set, re-run this node's executor iteratively until a stop condition is
   * met. Only valid on `agent` and `shell` nodes.
   */
  loop?: LoopConfig;
  /**
   * When set, fan the node out into one concurrent execution per item, injecting
   * the item into the prompt/script. Only valid on `agent` and `shell` nodes and
   * cannot be combined with `loop`. The node's output is `{ items: [...] }`.
   */
  matrix?: MatrixConfig;
  /**
   * When set on an agent node, the executor instructs the model to return JSON
   * conforming to the declared schema, then parses + validates it and stores it
   * at `output.data` so downstream nodes can reference it via data-flow paths
   * like `{{ nodes.<id>.data.<field> }}`.
   */
  structuredOutput?: StructuredOutputConfig;
  /**
   * When set on an agent node, top-K codebase search results are prepended to
   * the prompt as context (see {@link RetrievalConfig}).
   */
  retrieval?: RetrievalConfig;
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
  board: BoardConfig;
  workflow: WorkflowConfig;
}
