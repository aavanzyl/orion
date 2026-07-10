import type { ProjectId } from './project.model.js';
import type { TicketId } from './ticket.model.js';
import type { WorkflowConfig, WorkflowNodeType } from './config.model.js';

export type RunId = string;
export type RunNodeId = string;

/**
 * Lifecycle of a workflow run. The engine is a deterministic state machine;
 * `waiting` means a human approval or external event is required to continue.
 * `queued` means the run is admitted but parked behind the concurrency limit.
 */
export type RunStatus =
  | 'created'
  | 'queued'
  | 'scheduled'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RunNodeStatus =
  | 'pending'
  | 'blocked'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface WorkflowRun {
  id: RunId;
  ticketId: TicketId;
  projectId: ProjectId;
  workflowName: string;
  status: RunStatus;
  /** Branch created for this run inside the isolated worktree. */
  branch?: string;
  /** Absolute path to the git worktree allocated for this run. */
  worktreePath?: string;
  /** Harness thread id, enabling resume across process restarts. */
  threadId?: string;
  error?: string;
  /** Sum of token usage across all nodes in the run. */
  totalTokens?: number;
  /** Sum of cost (USD) across all nodes in the run. */
  costUsd?: number;
  /** Latest git diff captured during the run. */
  diff?: string;
  /** Aggregated node outputs and logs collected on run completion. */
  artifacts?: RunArtifacts;
  /**
   * Immutable snapshot of the workflow + agents that produced this run. Enables
   * correlating historical runs (and evaluations) to the exact configuration
   * used, even after the project config later changes.
   */
  configSnapshot?: RunConfigSnapshot;
  /** Wall-clock duration of the run in milliseconds (createdAt → last update). */
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
}

/** Snapshot of the configuration a run executed with, stored for evaluations. */
export interface RunConfigSnapshot {
  workflow: WorkflowConfig;
}

export interface RunArtifacts {
  nodeOutputs: Record<string, unknown>;
  aggregatedLogs?: string;
}

/** Token/cost usage recorded for a run node (best-effort from the harness). */
export interface RunNodeUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  costUsd?: number;
}

export interface RunNode {
  id: RunNodeId;
  runId: RunId;
  /** Matches the node id from the workflow config. */
  nodeKey: string;
  type: WorkflowNodeType;
  status: RunNodeStatus;
  dependsOn: string[];
  input?: unknown;
  output?: unknown;
  error?: string;
  /** Token/cost usage for this node (summed across loop iterations). */
  usage?: RunNodeUsage;
  /** Number of executor attempts made (1 = no retries). */
  attempts?: number;
  /** True when the final attempt was aborted by the node's timeout. */
  timedOut?: boolean;
  /** Wall-clock duration of the node in milliseconds. */
  durationMs?: number;
  /** Model identifier the agent node ran with (for agent nodes). */
  model?: string;
  /** Agent id the node ran as (for agent nodes). */
  agentId?: string;
  startedAt?: string;
  completedAt?: string;
}
