import { desc, eq, inArray } from 'drizzle-orm';
import type { CreateProjectInput, Project, ProjectId, UpdateProjectInput } from '@orion/models';
import type { Database } from '../client.js';
import { projectPaths, projects } from '../schema.js';
import { toProject } from '../mappers.js';

export class ProjectRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<Project[]> {
    const projectRows = await this.db.select().from(projects).orderBy(desc(projects.createdAt));
    const projectIds = projectRows.map((r) => r.id);
    const pathRows =
      projectIds.length > 0
        ? await this.db.select().from(projectPaths).where(
            inArray(projectPaths.projectId, projectIds),
          )
        : [];
    const pathsByProject = new Map<string, string[]>();
    for (const pr of pathRows) {
      const list = pathsByProject.get(pr.projectId) ?? [];
      list.push(pr.path);
      pathsByProject.set(pr.projectId, list);
    }
    return projectRows.map((row) =>
      toProject(row, pathsByProject.get(row.id)?.sort()),
    );
  }

  async get(id: ProjectId): Promise<Project | null> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id));
    if (!row) return null;
    const pathRows = await this.db
      .select()
      .from(projectPaths)
      .where(eq(projectPaths.projectId, id));
    const paths = pathRows.map((pr) => pr.path).sort();
    return toProject(row, paths.length > 0 ? paths : undefined);
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
        configYaml: input.configYaml ?? null,
      })
      .returning();

    const paths = (input.paths ?? []).filter((p) => p.trim());
    if (paths.length > 0) {
      await this.db.insert(projectPaths).values(
        paths.map((p) => ({ projectId: row.id, path: p })),
      );
    }

    const resultPaths = paths.length > 0 ? paths : undefined;
    return toProject(row, resultPaths);
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
    if (input.configYaml !== undefined) values.configYaml = input.configYaml ?? null;

    const [row] = await this.db
      .update(projects)
      .set(values)
      .where(eq(projects.id, id))
      .returning();
    if (!row) return null;

    if (input.paths !== undefined) {
      await this.db.delete(projectPaths).where(eq(projectPaths.projectId, id));
      const paths = input.paths.filter((p) => p.trim());
      if (paths.length > 0) {
        await this.db.insert(projectPaths).values(
          paths.map((p) => ({ projectId: id, path: p })),
        );
      }
    }

    const pathRows = await this.db
      .select()
      .from(projectPaths)
      .where(eq(projectPaths.projectId, id));
    const resultPaths = pathRows.map((pr) => pr.path).sort();
    return toProject(row, resultPaths.length > 0 ? resultPaths : undefined);
  }

  async delete(id: ProjectId): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }
}
