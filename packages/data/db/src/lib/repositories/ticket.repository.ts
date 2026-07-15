import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type {
  CreateTicketInput,
  MoveTicketInput,
  NewTicketRelation,
  ProjectId,
  Ticket,
  TicketDetail,
  TicketId,
  TicketRelation,
  TicketRelationView,
  TicketSource,
  UpdateTicketInput,
} from '@orion/models';
import type { Database } from '../client.js';
import { projects, ticketLabels, ticketRelations, tickets } from '../schema.js';
import { toTicket, toTicketRelation } from '../mappers.js';

function generateDisplayKey(projectName: string, counter: number): string {
  const key =
    projectName
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .substring(0, 6) || 'PROJ';
  return `${key}-${counter}`;
}

export class TicketRepository {
  constructor(private readonly db: Database) {}

  /** Fetch the label ids attached to each of the given tickets. */
  private async labelIdsFor(ticketIds: TicketId[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (ticketIds.length === 0) return map;
    const rows = await this.db
      .select()
      .from(ticketLabels)
      .where(inArray(ticketLabels.ticketId, ticketIds));
    for (const row of rows) {
      const bucket = map.get(row.ticketId) ?? [];
      bucket.push(row.labelId);
      map.set(row.ticketId, bucket);
    }
    return map;
  }

  async listByProject(projectId: ProjectId): Promise<Ticket[]> {
    const rows = await this.db
      .select()
      .from(tickets)
      .where(eq(tickets.projectId, projectId))
      .orderBy(asc(tickets.position), asc(tickets.createdAt));
    const labels = await this.labelIdsFor(rows.map((r) => r.id));
    return rows.map((row) => toTicket(row, labels.get(row.id) ?? []));
  }

  async listAll(): Promise<Ticket[]> {
    const rows = await this.db
      .select()
      .from(tickets)
      .orderBy(asc(tickets.projectId), asc(tickets.swimlaneKey), asc(tickets.position), asc(tickets.createdAt));
    const labels = await this.labelIdsFor(rows.map((r) => r.id));
    return rows.map((row) => toTicket(row, labels.get(row.id) ?? []));
  }

  async get(id: TicketId): Promise<Ticket | null> {
    const [row] = await this.db.select().from(tickets).where(eq(tickets.id, id));
    if (!row) return null;
    const labels = await this.labelIdsFor([id]);
    return toTicket(row, labels.get(id) ?? []);
  }

  async create(input: CreateTicketInput & { swimlane: string }): Promise<Ticket> {
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .select({ name: projects.name, counter: projects.counter })
        .from(projects)
        .where(eq(projects.id, input.projectId));

      if (!project) throw new Error(`Project ${input.projectId} not found`);

      const newCounter = project.counter + 1;
      const displayKey = generateDisplayKey(project.name, newCounter);

      await tx
        .update(projects)
        .set({ counter: newCounter })
        .where(eq(projects.id, input.projectId));

      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${tickets.position}), -1) + 1` })
        .from(tickets)
        .where(
          and(eq(tickets.projectId, input.projectId), eq(tickets.swimlaneKey, input.swimlane)),
        );

      let priority: number = input.priority ?? 0;
      let epicId = input.epicId ?? null;
      const labelIds = dedupe(input.labelIds ?? []);

      if (input.parentId) {
        const [parent] = await tx
          .select()
          .from(tickets)
          .where(eq(tickets.id, input.parentId));
        if (parent) {
          priority = parent.priority;
          epicId = parent.epicId ?? null;
        }
      }

      const inheritedLabelIds: string[] = [];
      if (input.parentId) {
        const parentLabels = await tx
          .select()
          .from(ticketLabels)
          .where(eq(ticketLabels.ticketId, input.parentId));
        for (const pl of parentLabels) {
          if (!labelIds.includes(pl.labelId)) {
            inheritedLabelIds.push(pl.labelId);
          }
        }
      }

      const allLabelIds = [...labelIds, ...inheritedLabelIds];

      const [row] = await tx
        .insert(tickets)
        .values({
          projectId: input.projectId,
          title: input.title,
          description: input.description ?? '',
          swimlaneKey: input.swimlane,
          agentId: input.agentId ?? null,
          workflowName: input.workflowName ?? null,
          priority,
          parentId: input.parentId ?? null,
          position: next,
          source: input.source ?? 'native',
          externalId: input.externalId ?? null,
          displayKey,
          type: input.type ?? 'feature',
          startDate: input.startDate ? new Date(input.startDate) : null,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          epicId,
        })
        .returning();

      if (allLabelIds.length > 0) {
        await tx
          .insert(ticketLabels)
          .values(allLabelIds.map((labelId) => ({ ticketId: row.id, labelId })));
      }

      for (const relation of input.relations ?? []) {
        await tx.insert(ticketRelations).values(normalizeRelation(row.id, relation));
      }

      return toTicket(row, allLabelIds);
    });
  }

  async getByExternal(
    projectId: ProjectId,
    source: TicketSource,
    externalId: string,
  ): Promise<Ticket | null> {
    const [row] = await this.db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.projectId, projectId),
          eq(tickets.source, source),
          eq(tickets.externalId, externalId),
        ),
      );
    if (!row) return null;
    const labels = await this.labelIdsFor([row.id]);
    return toTicket(row, labels.get(row.id) ?? []);
  }

  async update(id: TicketId, input: UpdateTicketInput): Promise<Ticket> {
    return this.db.transaction(async (tx) => {
      const values: Partial<typeof tickets.$inferInsert> = { updatedAt: new Date() };
      if (input.title !== undefined) values.title = input.title;
      if (input.description !== undefined) values.description = input.description;
      if (input.swimlane !== undefined) values.swimlaneKey = input.swimlane;
      if (input.workflowName !== undefined) values.workflowName = input.workflowName;
      if (input.priority !== undefined) values.priority = input.priority;
      if (input.parentId !== undefined) values.parentId = input.parentId;
      if (input.agentId !== undefined) values.agentId = input.agentId;
      if (input.type !== undefined) values.type = input.type;
      if (input.startDate !== undefined) {
        values.startDate = input.startDate ? new Date(input.startDate) : null;
      }
      if (input.dueDate !== undefined) {
        values.dueDate = input.dueDate ? new Date(input.dueDate) : null;
      }
      if (input.epicId !== undefined) values.epicId = input.epicId;

      const [row] = await tx
        .update(tickets)
        .set(values)
        .where(eq(tickets.id, id))
        .returning();

      let labelIds: string[];
      if (input.labelIds !== undefined) {
        labelIds = dedupe(input.labelIds);
        await tx.delete(ticketLabels).where(eq(ticketLabels.ticketId, id));
        if (labelIds.length > 0) {
          await tx
            .insert(ticketLabels)
            .values(labelIds.map((labelId) => ({ ticketId: id, labelId })));
        }
      } else {
        const existing = await tx
          .select()
          .from(ticketLabels)
          .where(eq(ticketLabels.ticketId, id));
        labelIds = existing.map((r) => r.labelId);
      }

      return toTicket(row, labelIds);
    });
  }

  async move(input: MoveTicketInput): Promise<Ticket> {
    const [row] = await this.db
      .update(tickets)
      .set({
        swimlaneKey: input.swimlane,
        position: input.order ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, input.ticketId))
      .returning();
    const labels = await this.labelIdsFor([row.id]);
    return toTicket(row, labels.get(row.id) ?? []);
  }

  async setAgent(id: TicketId, agentId: string | null): Promise<Ticket> {
    const [row] = await this.db
      .update(tickets)
      .set({ agentId, updatedAt: new Date() })
      .where(eq(tickets.id, id))
      .returning();
    const labels = await this.labelIdsFor([row.id]);
    return toTicket(row, labels.get(row.id) ?? []);
  }

  async listChildren(parentId: TicketId): Promise<Ticket[]> {
    const rows = await this.db
      .select()
      .from(tickets)
      .where(eq(tickets.parentId, parentId))
      .orderBy(asc(tickets.position), asc(tickets.createdAt));
    const labels = await this.labelIdsFor(rows.map((r) => r.id));
    return rows.map((row) => toTicket(row, labels.get(row.id) ?? []));
  }

  async addRelation(ticketId: TicketId, relation: NewTicketRelation): Promise<TicketRelation> {
    const [row] = await this.db
      .insert(ticketRelations)
      .values(normalizeRelation(ticketId, relation))
      .returning();
    return toTicketRelation(row);
  }

  async removeRelation(relationId: string): Promise<void> {
    await this.db.delete(ticketRelations).where(eq(ticketRelations.id, relationId));
  }

  async delete(id: TicketId): Promise<boolean> {
    const rows = await this.db
      .delete(tickets)
      .where(eq(tickets.id, id))
      .returning({ id: tickets.id });
    return rows.length > 0;
  }

  /** Assemble a ticket with its labels, parent, children and relations. */
  async getDetail(id: TicketId): Promise<TicketDetail | null> {
    const ticket = await this.get(id);
    if (!ticket) return null;

    const [labelIds, children, relationRows] = await Promise.all([
      this.labelIdsFor([id]),
      this.listChildren(id),
      this.db
        .select()
        .from(ticketRelations)
        .where(
          or(
            eq(ticketRelations.sourceTicketId, id),
            eq(ticketRelations.targetTicketId, id),
          ),
        ),
    ]);

    const attachedLabelIds = labelIds.get(id) ?? [];
    const parent = ticket.parentId ? await this.get(ticket.parentId) : null;

    const relatedIds = new Set<string>();
    for (const row of relationRows) {
      relatedIds.add(row.sourceTicketId === id ? row.targetTicketId : row.sourceTicketId);
    }
    const relatedTickets = await this.getMany([...relatedIds]);

    const relations: TicketRelationView[] = [];
    for (const row of relationRows) {
      const otherId = row.sourceTicketId === id ? row.targetTicketId : row.sourceTicketId;
      const other = relatedTickets.get(otherId);
      if (!other) continue;
      const kind =
        row.type === 'related'
          ? ('related' as const)
          : row.sourceTicketId === id
            ? ('blocks' as const)
            : ('blocked_by' as const);
      relations.push({ relationId: row.id, kind, ticket: other });
    }

    return {
      ...ticket,
      labelIds: attachedLabelIds,
      labels: [],
      parent: parent ?? undefined,
      children,
      relations,
    };
  }

  private async getMany(ids: TicketId[]): Promise<Map<string, Ticket>> {
    const map = new Map<string, Ticket>();
    if (ids.length === 0) return map;
    const rows = await this.db.select().from(tickets).where(inArray(tickets.id, ids));
    const labels = await this.labelIdsFor(rows.map((r) => r.id));
    for (const row of rows) {
      map.set(row.id, toTicket(row, labels.get(row.id) ?? []));
    }
    return map;
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Turn a ticket-perspective relation into a canonical directed row. */
function normalizeRelation(
  ticketId: TicketId,
  relation: NewTicketRelation,
): typeof ticketRelations.$inferInsert {
  switch (relation.kind) {
    case 'blocks':
      return { sourceTicketId: ticketId, targetTicketId: relation.ticketId, type: 'blocks' };
    case 'blocked_by':
      return { sourceTicketId: relation.ticketId, targetTicketId: ticketId, type: 'blocks' };
    case 'related':
      return { sourceTicketId: ticketId, targetTicketId: relation.ticketId, type: 'related' };
  }
}
