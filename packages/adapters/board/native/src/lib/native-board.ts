import type { BoardProvider } from '@orion/board-core';
import type { LabelRepository, TicketRepository } from '@orion/db';
import type {
  Board,
  BoardSwimlane,
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

/** Turn a column key such as `in_progress` into a display title. */
function titleize(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Native Kanban board backed by Postgres. This is the default board provider;
 * external providers (Jira, Trello, Linear) implement the same interface.
 */
export class NativeBoardProvider implements BoardProvider {
  readonly key = 'native';

  constructor(
    private readonly tickets: TicketRepository,
    private readonly labels: LabelRepository,
  ) {}

  async getBoard(
    projectId: ProjectId,
    swimlanes: string[],
    triggers?: Record<string, string[]>,
  ): Promise<Board> {
    const all = await this.tickets.listByProject(projectId);
    const bySwimlane = new Map<string, Ticket[]>();
    for (const swimlane of swimlanes) {
      bySwimlane.set(swimlane, []);
    }
    for (const ticket of all) {
      const bucket = bySwimlane.get(ticket.swimlane) ?? bySwimlane.set(ticket.swimlane, []).get(ticket.swimlane)!;
      bucket.push(ticket);
    }

    const boardSwimlanes: BoardSwimlane[] = swimlanes.map((key) => {
      const workflows = triggers?.[key];

      return {
        key,
        title: titleize(key),
        tickets: (bySwimlane.get(key) ?? []).sort((a, b) => a.order - b.order),
        workflows: workflows && workflows.length > 0 ? workflows : undefined,
      };
    });

    return { projectId, swimlanes: boardSwimlanes };
  }

  createTicket(input: CreateTicketInput): Promise<Ticket> {
    return this.tickets.create({ ...input, swimlane: input.swimlane ?? 'backlog' });
  }

  updateTicket(ticketId: TicketId, input: UpdateTicketInput): Promise<Ticket> {
    return this.tickets.update(ticketId, input);
  }

  moveTicket(input: MoveTicketInput): Promise<Ticket> {
    return this.tickets.move(input);
  }

  getTicket(ticketId: TicketId): Promise<Ticket | null> {
    return this.tickets.get(ticketId);
  }

  async getTicketDetail(ticketId: TicketId): Promise<TicketDetail | null> {
    const detail = await this.tickets.getDetail(ticketId);
    if (!detail) return null;
    detail.labels = await this.labels.listByIds(detail.labelIds);
    return detail;
  }

  updateTicketAgent(ticketId: TicketId, agentId: string | null): Promise<Ticket> {
    return this.tickets.setAgent(ticketId, agentId);
  }

  listLabels(projectId: ProjectId): Promise<Label[]> {
    return this.labels.listByProject(projectId);
  }

  createLabel(input: CreateLabelInput): Promise<Label> {
    return this.labels.create(input);
  }

  deleteLabel(labelId: string): Promise<void> {
    return this.labels.delete(labelId);
  }

  addRelation(ticketId: TicketId, relation: NewTicketRelation): Promise<TicketRelation> {
    return this.tickets.addRelation(ticketId, relation);
  }

  removeRelation(relationId: string): Promise<void> {
    return this.tickets.removeRelation(relationId);
  }
}
