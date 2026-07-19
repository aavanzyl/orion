import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { CreateLabelInput, Label, ProjectId } from '@orion/models';
import type { Database } from '../client.js';
import { labels } from '../schema.js';
import { toLabel } from '../mappers.js';

const DEFAULT_COLOR = '#6366f1';

export class LabelRepository {
  constructor(private readonly db: Database) {}

  async listByProject(projectId: ProjectId): Promise<Label[]> {
    const rows = await this.db
      .select()
      .from(labels)
      .where(eq(labels.projectId, projectId))
      .orderBy(asc(labels.name));
    return rows.map(toLabel);
  }

  async listAll(): Promise<Label[]> {
    const rows = await this.db
      .select()
      .from(labels)
      .orderBy(asc(labels.projectId), asc(labels.name));
    return rows.map(toLabel);
  }

  async listByIds(ids: string[]): Promise<Label[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(labels).where(inArray(labels.id, ids));
    return rows.map(toLabel);
  }

  async getByName(projectId: ProjectId, name: string): Promise<Label | null> {
    const [row] = await this.db
      .select()
      .from(labels)
      .where(
        sql`${labels.projectId} = ${projectId} AND LOWER(${labels.name}) = LOWER(${name})`,
      );
    return row ? toLabel(row) : null;
  }

  async create(input: CreateLabelInput): Promise<Label> {
    const [row] = await this.db
      .insert(labels)
      .values({
        projectId: input.projectId,
        name: input.name,
        color: input.color ?? DEFAULT_COLOR,
      })
      .returning();
    return toLabel(row);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(labels).where(eq(labels.id, id));
  }
}
