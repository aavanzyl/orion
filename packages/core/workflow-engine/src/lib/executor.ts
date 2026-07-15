import type {
  ProjectConfig,
  RunEventType,
  RunNode,
  WorkflowNodeConfig,
  WorkflowNodeType,
  WorkflowRun,
} from '@orion/models';

/** A single repository participating in a run (isolated in its own worktree). */
export interface RunWorkspaceRepo {
  /** Repository name (folder name); unique within the workspace. */
  name: string;
  /** Agent-visible working path (an isolated worktree). */
  path: string;
  /** Resolved source repo used for SCM operations (e.g. opening PRs). */
  originPath: string;
  /** Branch created for this run. */
  branch: string;
  /** Branch the run should target when opening a pull request. */
  baseBranch: string;
}

/**
 * Isolated workspace for a run. `rootPath` is where the agent runs: for a
 * single-repo project it is that repo's worktree; for a multi-repo workspace it
 * is a folder containing one worktree per member repository.
 */
export interface RunWorkspace {
  rootPath: string;
  /** Directory containing the `.orion` config for this run. */
  configRoot: string;
  repos: RunWorkspaceRepo[];
}

export interface NodeExecutionContext {
  run: WorkflowRun;
  node: RunNode;
  nodeConfig: WorkflowNodeConfig;
  config: ProjectConfig;
  workspace: RunWorkspace;
  ticketId: string;
  /** Emit a run event scoped to the current node. */
  emit: (type: RunEventType, payload: unknown) => Promise<void>;
  signal?: AbortSignal;
  /** Outputs of already-completed upstream nodes, keyed by node id, for data flow. */
  nodeOutputs: Record<string, unknown>;
}

/** Token/cost usage for a node (mirrors HarnessUsage; local to avoid a dep). */
export interface NodeUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  costUsd?: number;
}

/**
 * Optional per-node telemetry surfaced by executors and the engine, persisted
 * for evaluations. Executors fill in what they know (e.g. an agent supplies its
 * model/agentId); the engine fills in attempts/timedOut.
 */
export interface NodeTelemetry {
  /** Executor attempts made (1 = succeeded first try). Set by the engine. */
  attempts?: number;
  /** True when the final attempt was aborted by the node's timeout. */
  timedOut?: boolean;
  /** Model identifier the node ran with (agent nodes). */
  model?: string;
  /** Agent id the node ran as (agent nodes). */
  agentId?: string;
}

export type NodeOutcome =
  | { status: 'completed'; output?: unknown; threadId?: string; usage?: NodeUsage; telemetry?: NodeTelemetry }
  | { status: 'waiting'; output?: unknown; telemetry?: NodeTelemetry }
  | { status: 'failed'; error: string; telemetry?: NodeTelemetry };

/** Executes exactly one node type. Injected into the engine by the host app. */
export interface NodeExecutor {
  readonly type: WorkflowNodeType;
  execute(ctx: NodeExecutionContext): Promise<NodeOutcome>;
}
