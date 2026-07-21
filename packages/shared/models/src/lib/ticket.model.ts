import type { ProjectId } from './project.model.js';

export type TicketId = string;
export type EpicId = string;

/** Where a ticket originates. `native` tickets live only in Orion's board. */
export type TicketSource = 'native' | 'jira' | 'trello' | 'linear' | 'github';

/** The kind of work a ticket represents. Project-configurable via issueTypes. */
export type TicketType = string;

/** Built-in defaults used when no project-specific issue types are configured. */
export const DEFAULT_TICKET_TYPES: ReadonlyArray<{ value: TicketType; label: string }> = [
  { value: 'feature', label: 'Feature' },
  { value: 'bug', label: 'Bug' },
  { value: 'issue', label: 'Issue' },
  { value: 'hotfix', label: 'Hotfix' },
];

/**
 * The "epic" issue type is always available regardless of project configuration.
 * It is not included in `DEFAULT_TICKET_TYPES` because it cannot be removed or
 * reconfigured.
 */
export const EPIC_TYPE = { value: 'epic' as TicketType, label: 'Epic' };

/** All built-in issue types including the always-present epic. */
export const ALL_DEFAULT_TICKET_TYPES = [...DEFAULT_TICKET_TYPES, EPIC_TYPE];

/**
 * Ticket priority, mirroring Linear's scale.
 * `0` = no priority, `1` = urgent, ... `4` = low.
 */
export type TicketPriority = 0 | 1 | 2 | 3 | 4;

export const TICKET_PRIORITIES: ReadonlyArray<{ value: TicketPriority; label: string }> = [
  { value: 0, label: 'No priority' },
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Medium' },
  { value: 4, label: 'Low' },
];

/** A high-level grouping of tickets that spans a milestone or initiative. */
export interface Epic {
  id: EpicId;
  projectId: ProjectId;
  title: string;
  description: string;
  /** Hex color used to render the epic bar / badge. */
  color: string;
  /** Optional identifier from an external system (e.g. Linear project id). */
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEpicInput {
  projectId: ProjectId;
  title: string;
  description?: string;
  color?: string;
}

export interface UpdateEpicInput {
  title?: string;
  description?: string;
  color?: string;
}

/** A reusable, colored label defined per project (Linear-style). */
export interface Label {
  id: string;
  projectId: ProjectId;
  name: string;
  /** Hex color used to render the label badge. */
  color: string;
  createdAt: string;
}

export interface CreateLabelInput {
  projectId: ProjectId;
  name: string;
  color?: string;
}

/**
 * Directed relationship stored between two tickets. Only canonical types are
 * persisted: `blocks` (source blocks target) and `related` (symmetric).
 */
export type TicketRelationType = 'blocks' | 'related';

/** Relation types as expressed from the perspective of a single ticket. */
export type TicketRelationKind = 'blocks' | 'blocked_by' | 'related';

export interface TicketRelation {
  id: string;
  sourceTicketId: TicketId;
  targetTicketId: TicketId;
  type: TicketRelationType;
  createdAt: string;
}

export interface Ticket {
  id: TicketId;
  projectId: ProjectId;
  title: string;
  /** Markdown body. */
  description: string;
  /** Board swimlane key the ticket currently occupies. */
  swimlane: string;
  /** Agent id assigned to work this ticket, if any. */
  agentId?: string;
  /** Workflow name this ticket is bound to for sub-swimlane routing. */
  workflowName?: string;
  priority: TicketPriority;
  /** Parent ticket id when this ticket is a sub-issue. */
  parentId?: TicketId;
  /** Ids of labels attached to this ticket. */
  labelIds: string[];
  source: TicketSource;
  /** Identifier in the external board system, when not native. */
  externalId?: string;
  /** Sort order within its swimlane. */
  order: number;
  /** JIRA-style display key, e.g. ORION-42. */
  displayKey?: string;
  /** The kind of work this ticket represents. */
  type: TicketType;
  /** Optional start date for timeline bar placement. ISO 8601 string. */
  startDate?: string;
  /** Optional due date for scheduling and timeline views. ISO 8601 string. */
  dueDate?: string;
  /** Optional epic this ticket belongs to. */
  epicId?: EpicId;
  createdAt: string;
  updatedAt: string;
}

/** A relation resolved to the related ticket, from one ticket's perspective. */
export interface TicketRelationView {
  relationId: string;
  kind: TicketRelationKind;
  ticket: Ticket;
}

/** A ticket with its labels, parent, sub-issues and relations resolved. */
export interface TicketDetail extends Ticket {
  labels: Label[];
  parent?: Ticket;
  children: Ticket[];
  relations: TicketRelationView[];
}

/** A relation to create, expressed from the perspective of the ticket. */
export interface NewTicketRelation {
  kind: TicketRelationKind;
  ticketId: TicketId;
}

export interface CreateTicketInput {
  projectId: ProjectId;
  title: string;
  description?: string;
  swimlane?: string;
  agentId?: string;
  workflowName?: string;
  priority?: TicketPriority;
  parentId?: TicketId;
  labelIds?: string[];
  relations?: NewTicketRelation[];
  source?: TicketSource;
  externalId?: string;
  /** Ticket type; defaults to `feature`. */
  type?: TicketType;
  /** Optional start date in ISO 8601 format. */
  startDate?: string;
  /** Optional due date in ISO 8601 format. */
  dueDate?: string;
  /** Optional epic to assign this ticket to. */
  epicId?: EpicId | null;
}

export interface UpdateTicketInput {
  title?: string;
  description?: string;
  swimlane?: string;
  workflowName?: string;
  priority?: TicketPriority;
  parentId?: TicketId | null;
  labelIds?: string[];
  agentId?: string | null;
  /** Ticket type. */
  type?: TicketType;
  /** Optional start date in ISO 8601 format. Pass null to clear. */
  startDate?: string | null;
  /** Optional due date in ISO 8601 format. Pass null to clear. */
  dueDate?: string | null;
  /** Optional epic to assign this ticket to. Pass null to remove. */
  epicId?: EpicId | null;
}

export interface MoveTicketInput {
  ticketId: TicketId;
  swimlane: string;
  order?: number;
}

export interface TicketComment {
  id: string;
  ticketId: TicketId;
  body: string;
  createdAt: string;
}

export interface CreateTicketCommentInput {
  ticketId: TicketId;
  body: string;
}
