import type { Keyed } from '@orion/adapter-kit';
import { ProviderRegistry } from '@orion/adapter-kit';
import type {
  Board,
  CreateLabelInput,
  CreateTicketInput,
  Label,
  MoveTicketInput,
  NewTicketRelation,
  ProjectId,
  Ticket,
  TicketDetail,
  TicketId,
  TicketRelation,
  UpdateTicketInput,
} from '@orion/models';

/**
 * Task-board adapter. The native provider stores tickets in Postgres; future
 * providers (Jira, Trello, Linear) sync against external systems behind the
 * same interface.
 */
export interface BoardProvider extends Keyed {
  getBoard(
    projectId: ProjectId,
    swimlanes: string[],
  ): Promise<Board>;
  createTicket(input: CreateTicketInput): Promise<Ticket>;
  updateTicket(ticketId: TicketId, input: UpdateTicketInput): Promise<Ticket>;
  moveTicket(input: MoveTicketInput): Promise<Ticket>;
  getTicket(ticketId: TicketId): Promise<Ticket | null>;
  getTicketDetail(ticketId: TicketId): Promise<TicketDetail | null>;
  updateTicketAgent(ticketId: TicketId, agentId: string | null): Promise<Ticket>;
  /** Labels defined for the project. */
  listLabels(projectId: ProjectId): Promise<Label[]>;
  createLabel(input: CreateLabelInput): Promise<Label>;
  deleteLabel(labelId: string): Promise<void>;
  /** Ticket relationships (blocking / blocked-by / related). */
  addRelation(ticketId: TicketId, relation: NewTicketRelation): Promise<TicketRelation>;
  removeRelation(relationId: string): Promise<void>;
  /** Delete a ticket permanently. */
  deleteTicket(ticketId: TicketId): Promise<boolean>;
  /** Pull latest state from an external board, if applicable. */
  sync?(projectId: ProjectId): Promise<void>;
}

export class BoardRegistry extends ProviderRegistry<BoardProvider> {
  constructor() {
    super('board');
  }
}
