import { asc, desc, eq } from 'drizzle-orm';
import type {
  CreateTriggerInput,
  Trigger,
  TriggerId,
  UpdateTriggerInput,
} from '@orion/models';
import type { Database } from '../client.js';
import { triggers } from '../schema.js';
import { toTrigger } from '../mappers.js';

/** Fields set when creating a trigger that fall outside the public input. */
export interface CreateTriggerRow extends CreateTriggerInput {
  webhookToken?: string | null;
  nextFireAt?: Date | null;
}

/** Internal patch supporting the derived `webhookToken`/`nextFireAt` columns. */
export interface UpdateTriggerRow extends UpdateTriggerInput {
  webhookToken?: string | null;
  nextFireAt?: Date | null;
}

export class TriggerRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateTriggerRow): Promise<Trigger> {
    const [row] = await this.db
      .insert(triggers)
      .values({
        projectId: input.projectId,
        name: input.name,
        type: input.type,
        enabled: input.enabled ?? true,
        action: input.action ?? 'workflow',
        cron: input.cron ?? null,
        webhookToken: input.webhookToken ?? null,
        ticketTitle: input.ticketTitle ?? null,
        ticketDescription: input.ticketDescription ?? null,
        swimlaneKey: input.swimlane ?? null,
        agentId: input.agentId ?? null,
        prompt: input.prompt ?? null,
        nextFireAt: input.nextFireAt ?? null,
      })
      .returning();
    return toTrigger(row);
  }

  async list(projectId: string): Promise<Trigger[]> {
    const rows = await this.db
      .select()
      .from(triggers)
      .where(eq(triggers.projectId, projectId))
      .orderBy(desc(triggers.createdAt));
    return rows.map(toTrigger);
  }

  /** Every enabled trigger across all projects, oldest first. */
  async listAllEnabled(): Promise<Trigger[]> {
    const rows = await this.db
      .select()
      .from(triggers)
      .where(eq(triggers.enabled, true))
      .orderBy(asc(triggers.createdAt));
    return rows.map(toTrigger);
  }

  async get(id: TriggerId): Promise<Trigger | null> {
    const [row] = await this.db.select().from(triggers).where(eq(triggers.id, id));
    return row ? toTrigger(row) : null;
  }

  async getByWebhookToken(token: string): Promise<Trigger | null> {
    const [row] = await this.db
      .select()
      .from(triggers)
      .where(eq(triggers.webhookToken, token));
    return row ? toTrigger(row) : null;
  }

  async update(id: TriggerId, patch: UpdateTriggerRow): Promise<Trigger | null> {
    const values: Partial<typeof triggers.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.enabled !== undefined) values.enabled = patch.enabled;
    if (patch.action !== undefined) values.action = patch.action;
    if (patch.cron !== undefined) values.cron = patch.cron ?? null;
    if (patch.ticketTitle !== undefined) values.ticketTitle = patch.ticketTitle ?? null;
    if (patch.ticketDescription !== undefined) {
      values.ticketDescription = patch.ticketDescription ?? null;
    }
    if (patch.swimlane !== undefined) values.swimlaneKey = patch.swimlane ?? null;
    if (patch.agentId !== undefined) values.agentId = patch.agentId ?? null;
    if (patch.prompt !== undefined) values.prompt = patch.prompt ?? null;
    if (patch.webhookToken !== undefined) values.webhookToken = patch.webhookToken ?? null;
    if (patch.nextFireAt !== undefined) values.nextFireAt = patch.nextFireAt ?? null;

    const [row] = await this.db
      .update(triggers)
      .set(values)
      .where(eq(triggers.id, id))
      .returning();
    return row ? toTrigger(row) : null;
  }

  async delete(id: TriggerId): Promise<void> {
    await this.db.delete(triggers).where(eq(triggers.id, id));
  }

  /** Record a fire: update `lastFiredAt` and the next scheduled fire time. */
  async markFired(
    id: TriggerId,
    lastFiredAt: Date,
    nextFireAt: Date | null,
  ): Promise<Trigger | null> {
    const [row] = await this.db
      .update(triggers)
      .set({ lastFiredAt, nextFireAt, updatedAt: new Date() })
      .where(eq(triggers.id, id))
      .returning();
    return row ? toTrigger(row) : null;
  }
}
