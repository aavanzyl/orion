import type { ProjectId } from './project.model.js';
import type { Ticket } from './ticket.model.js';

export interface BoardSwimlane {
  key: string;
  title: string;
  tickets: Ticket[];
}

export interface Board {
  projectId: ProjectId;
  swimlanes: BoardSwimlane[];
  /** Configurable issue types available for new tickets in this project. */
  issueTypes?: { value: string; label: string }[];
}

/** What a swimlane entry did to the ticket's workflow, if anything. */
export type MoveTriggerAction = 'started' | 'retried' | 'none';

/** Why a swimlane entry did not start or resume a workflow. */
export type MoveTriggerReason =
  | 'active-run'
  | 'mid-workflow-lane'
  | 'no-trigger';

/**
 * Outcome of the auto-trigger evaluation that runs when a ticket enters a
 * swimlane (via the move endpoint or a board-sync pull). `started` means a new
 * run was created; `retried` means the latest failed run was resumed because
 * the destination lane matches the failed node's swimlane.
 */
export interface MoveTriggerResult {
  action: MoveTriggerAction;
  /** Present when `action` is `none`. */
  reason?: MoveTriggerReason;
  /** The run that was started or retried. */
  runId?: string;
  /** The workflow that was started or retried. */
  workflowName?: string;
}

/** Move response payload: the moved ticket plus the trigger outcome. */
export interface MoveTicketConflict {
  activeRunId: string;
  activeRunStatus: string;
}
