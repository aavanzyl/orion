import type { RunId, RunNodeId } from './run.model.js';

/**
 * Run events are the event-sourced record of everything that happens during a
 * run. They are persisted for audit/replay and streamed to the UI over SSE.
 */
export type RunEventType =
  | 'run.created'
  | 'run.status'
  | 'run.transition'
  | 'run.diff'
  | 'node.status'
  | 'node.started'
  | 'node.completed'
  | 'node.failed'
  | 'node.skipped'
  | 'node.cancelled'
  | 'node.retry'
  | 'node.iteration'
  | 'node.matrix'
  | 'agent.message'
  | 'agent.item'
  | 'agent.usage'
  | 'ticket.moved'
  | 'ticket.updated'
  | 'ticket.created'
  | 'ticket.deleted'
  | 'ticket.comment'
  | 'transition'
  | 'log'
  | 'sync.completed'
  | 'sync.failed';

export interface RunEvent<T = unknown> {
  id: string;
  runId: RunId;
  nodeId?: RunNodeId;
  type: RunEventType;
  payload: T;
  createdAt: string;
}

export interface CreateRunEventInput<T = unknown> {
  runId: RunId;
  nodeId?: RunNodeId;
  type: RunEventType;
  payload: T;
}
