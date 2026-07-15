import { asc, eq } from 'drizzle-orm';
import type { CreateEpicInput, Epic, EpicId, ProjectId, UpdateEpicInput } from '@orion/models';
import type { Database } from '../client.js';
import { epics } from '../schema.js';
import { toEpic } from '../mappers.js';

export class EpicRepository {
  constructor(private readonly db: Database) {}

  async listByProject(projectId: ProjectId): Promise<Epic[]> {
    const rows = await this.db
      .select()
      .from(epics)
      .where(eq(epics.projectId, projectId))
      .orderBy(asc(epics.createdAt));
    return rows.map(toEpic);
  }

  async get(id: EpicId): Promise<Epic | null> {
    const [row] = await this.db.select().from(epics).where(eq(epics.id, id));
    return row ? toEpic(row) : null;
  }

  async create(input: CreateEpicInput): Promise<Epic> {
    const [row] = await this.db
      .insert(epics)
      .values({
        projectId: input.projectId,
        title: input.title,
        description: input.description ?? '',
        color: input.color ?? '#7c3aed',
      })
      .returning();
    return toEpic(row);
  }

  async update(id: EpicId, input: UpdateEpicInput): Promise<Epic | null> {
    const values: Partial<typeof epics.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) values.title = input.title;
    if (input.description !== undefined) values.description = input.description;
    if (input.color !== undefined) values.color = input.color;

    const [row] = await this.db
      .update(epics)
      .set(values)
      .where(eq(epics.id, id))
      .returning();

    return row ? toEpic(row) : null;
  }

  async delete(id: EpicId): Promise<boolean> {
    const rows = await this.db
      .delete(epics)
      .where(eq(epics.id, id))
      .returning({ id: epics.id });
    return rows.length > 0;
  }
}
