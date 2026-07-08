import { desc, eq } from 'drizzle-orm';
import type { CreateProjectInput, Project, ProjectId, UpdateProjectInput } from '@orion/models';
import type { Database } from '../client.js';
import { projects } from '../schema.js';
import { toProject } from '../mappers.js';

export class ProjectRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<Project[]> {
    const rows = await this.db.select().from(projects).orderBy(desc(projects.createdAt));
    return rows.map(toProject);
  }

  async get(id: ProjectId): Promise<Project | null> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id));
    return row ? toProject(row) : null;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const [row] = await this.db
      .insert(projects)
      .values({
        name: input.name,
        sourceKind: input.sourceKind ?? 'remote',
        repoUrl: input.repoUrl ?? '',
        rootPath: input.rootPath ?? null,
        scmProvider: input.scmProvider ?? 'github',
        boardProvider: input.boardProvider ?? 'native',
        defaultBranch: input.defaultBranch ?? 'main',
        configPath: input.configPath ?? '.orion/config.yaml',
      })
      .returning();
    return toProject(row);
  }

  async update(id: ProjectId, input: UpdateProjectInput): Promise<Project | null> {
    const values: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) values.name = input.name;
    if (input.sourceKind !== undefined) values.sourceKind = input.sourceKind;
    if (input.repoUrl !== undefined) values.repoUrl = input.repoUrl;
    if (input.rootPath !== undefined) values.rootPath = input.rootPath ?? null;
    if (input.scmProvider !== undefined) values.scmProvider = input.scmProvider;
    if (input.boardProvider !== undefined) values.boardProvider = input.boardProvider;
    if (input.defaultBranch !== undefined) values.defaultBranch = input.defaultBranch;
    if (input.configPath !== undefined) values.configPath = input.configPath;

    const [row] = await this.db
      .update(projects)
      .set(values)
      .where(eq(projects.id, id))
      .returning();
    return row ? toProject(row) : null;
  }

  async delete(id: ProjectId): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }
}