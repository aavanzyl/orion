import { asc, desc, eq } from 'drizzle-orm';
import type {
  CreateScheduleInput,
  Schedule,
  ScheduleId,
  UpdateScheduleInput,
} from '@orion/models';
import type { Database } from '../client.js';
import { schedules } from '../schema.js';
import { toSchedule } from '../mappers.js';

/** Fields set when creating a schedule that fall outside the public input. */
export interface CreateScheduleRow extends CreateScheduleInput {
  nextFireAt?: Date | null;
}

/** Internal patch supporting the derived `nextFireAt` column. */
export interface UpdateScheduleRow extends UpdateScheduleInput {
  nextFireAt?: Date | null;
}

export class ScheduleRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateScheduleRow): Promise<Schedule> {
    const [row] = await this.db
      .insert(schedules)
      .values({
        projectId: input.projectId,
        name: input.name,
        enabled: input.enabled ?? true,
        cron: input.cron,
        instruction: input.instruction,
        skills: input.skills ?? [],
        mcpServers: input.mcpServers ?? [],
        mcpServerConfigs: input.mcpServerConfigs ?? {},
        nextFireAt: input.nextFireAt ?? null,
      })
      .returning();
    return toSchedule(row);
  }

  async list(projectId: string): Promise<Schedule[]> {
    const rows = await this.db
      .select()
      .from(schedules)
      .where(eq(schedules.projectId, projectId))
      .orderBy(desc(schedules.createdAt));
    return rows.map(toSchedule);
  }

  /** Every schedule across all projects, newest first. */
  async listAll(): Promise<Schedule[]> {
    const rows = await this.db.select().from(schedules).orderBy(desc(schedules.createdAt));
    return rows.map(toSchedule);
  }

  /** Every enabled schedule across all projects, oldest first. */
  async listAllEnabled(): Promise<Schedule[]> {
    const rows = await this.db
      .select()
      .from(schedules)
      .where(eq(schedules.enabled, true))
      .orderBy(asc(schedules.createdAt));
    return rows.map(toSchedule);
  }

  async get(id: ScheduleId): Promise<Schedule | null> {
    const [row] = await this.db.select().from(schedules).where(eq(schedules.id, id));
    return row ? toSchedule(row) : null;
  }

  async update(id: ScheduleId, patch: UpdateScheduleRow): Promise<Schedule | null> {
    const values: Partial<typeof schedules.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.enabled !== undefined) values.enabled = patch.enabled;
    if (patch.cron !== undefined) values.cron = patch.cron;
    if (patch.instruction !== undefined) values.instruction = patch.instruction;
    if (patch.skills !== undefined) values.skills = patch.skills;
    if (patch.mcpServers !== undefined) values.mcpServers = patch.mcpServers;
    if (patch.mcpServerConfigs !== undefined) values.mcpServerConfigs = patch.mcpServerConfigs;
    if (patch.nextFireAt !== undefined) values.nextFireAt = patch.nextFireAt ?? null;

    const [row] = await this.db
      .update(schedules)
      .set(values)
      .where(eq(schedules.id, id))
      .returning();
    return row ? toSchedule(row) : null;
  }

  async delete(id: ScheduleId): Promise<void> {
    await this.db.delete(schedules).where(eq(schedules.id, id));
  }

  /** Record a fire: update `lastFiredAt` and the next scheduled fire time. */
  async markFired(
    id: ScheduleId,
    lastFiredAt: Date,
    nextFireAt: Date | null,
  ): Promise<Schedule | null> {
    const [row] = await this.db
      .update(schedules)
      .set({ lastFiredAt, nextFireAt, updatedAt: new Date() })
      .where(eq(schedules.id, id))
      .returning();
    return row ? toSchedule(row) : null;
  }
}
