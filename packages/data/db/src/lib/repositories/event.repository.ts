import { and, asc, eq, gt } from 'drizzle-orm';
import type { CreateRunEventInput, RunEvent, RunId } from '@orion/models';
import type { Database } from '../client.js';
import { runEvents } from '../schema.js';
import { toRunEvent } from '../mappers.js';

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

  async listByRun(runId: RunId): Promise<RunEvent[]> {
    const rows = await this.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.createdAt));
    return rows.map(toRunEvent);
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
