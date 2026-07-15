import { and, asc, eq, gt } from 'drizzle-orm';
import type { CreateRunEventInput, RunEvent, RunEventType, RunId } from '@orion/models';
import type { Database } from '../client.js';
import { runEvents, workflowRuns } from '../schema.js';
import { toRunEvent } from '../mappers.js';

export interface EventListFilter {
  runId: RunId;
  type?: RunEventType;
  nodeId?: string;
  nodeKey?: string;
  limit?: number;
}

export class EventRepository {
  constructor(private readonly db: Database) {}

  async append(input: CreateRunEventInput): Promise<RunEvent> {
    const [row] = await this.db
      .insert(runEvents)
      .values({
        runId: input.runId,
        nodeId: input.nodeId ?? null,
        type: input.type,
        payload: input.payload ?? null,
      })
      .returning();
    return toRunEvent(row);
  }

  async listByRun(runId: RunId, filter?: { type?: RunEventType; nodeId?: string; limit?: number }): Promise<RunEvent[]> {
    const conditions = [eq(runEvents.runId, runId)];
    if (filter?.type) conditions.push(eq(runEvents.type, filter.type));
    if (filter?.nodeId) conditions.push(eq(runEvents.nodeId, filter.nodeId));

    const rows = await this.db
      .select()
      .from(runEvents)
      .where(and(...conditions))
      .orderBy(asc(runEvents.createdAt))
      .limit(filter?.limit ?? 500);

    return rows.map(toRunEvent);
  }

  /** List events for a ticket across all of its runs, with optional filters. */
  async listByTicket(
    ticketId: string,
    filter?: { type?: RunEventType; nodeKey?: string; limit?: number },
  ): Promise<RunEvent[]> {
    const conditions = [eq(workflowRuns.ticketId, ticketId)];
    if (filter?.type) conditions.push(eq(runEvents.type, filter.type));

    const rows = await this.db
      .select({
        id: runEvents.id,
        runId: runEvents.runId,
        nodeId: runEvents.nodeId,
        type: runEvents.type,
        payload: runEvents.payload,
        createdAt: runEvents.createdAt,
      })
      .from(runEvents)
      .innerJoin(workflowRuns, eq(runEvents.runId, workflowRuns.id))
      .where(and(...conditions))
      .orderBy(asc(runEvents.createdAt))
      .limit(filter?.limit ?? 500);

    const events = rows.map(toRunEvent);

    if (filter?.nodeKey) {
      return events.filter((e) => {
        if (e.nodeId) return true;
        const payload = e.payload as Record<string, unknown> | null;
        return payload?.nodeKey === filter.nodeKey;
      });
    }

    return events;
  }

  /** Fetch events created after a given timestamp (for SSE replay/catch-up). */
  async listSince(runId: RunId, since: Date): Promise<RunEvent[]> {
    const rows = await this.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.createdAt, since)))
      .orderBy(asc(runEvents.createdAt));
    return rows.map(toRunEvent);
  }
}
