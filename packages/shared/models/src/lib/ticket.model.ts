import type { ProjectId } from './project.model.js';

export type TicketId = string;

/** Where a ticket originates. `native` tickets live only in Orion's board. */
export type TicketSource = 'native' | 'jira' | 'trello' | 'linear';

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
}

export interface MoveTicketInput {
  ticketId: TicketId;
  swimlane: string;
  order?: number;
}
