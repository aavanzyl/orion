import type {
  CreateRunEventInput,
  RunNode,
  RunNodeStatus,
  WorkflowNodeType,
  WorkflowRun,
} from '@orion/models';

/**
 * Persistence port the engine needs. `@orion/db`'s RunRepository satisfies this
 * structurally, keeping the engine free of any database dependency.
 */
export interface RunStore {
  get(id: string): Promise<WorkflowRun | null>;
  listNodes(runId: string): Promise<RunNode[]>;
  createNode(input: {
    runId: string;
    nodeKey: string;
    type: WorkflowNodeType;
    dependsOn: string[];
    status?: RunNodeStatus;
  }): Promise<RunNode>;
  updateNode(id: string, patch: Partial<Omit<RunNode, 'id' | 'runId'>>): Promise<RunNode>;
  update(id: string, patch: Partial<Omit<WorkflowRun, 'id' | 'error'>> & { error?: string | null }): Promise<WorkflowRun>;
  /** Recompute and persist run-level usage totals by summing node usage. */
  recomputeUsage?(runId: string): Promise<void>;
}

/** Sink for event-sourced run events (persist + stream to the UI). */
export type EmitEvent = (event: CreateRunEventInput) => Promise<void>;

/** Callback used to reflect workflow progress onto the board. */
export type MoveTicket = (ticketId: string, swimlane: string) => Promise<void>;
