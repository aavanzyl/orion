import {
  getWorkflowTemplate,
  installSkillFromGitHub,
  listCommandFiles,
  listSkillCatalog,
  loadProjectConfig,
  loadProjectConfigFromYaml,
  readCommandText,
  readProjectConfigText,
  resolveIssueTypes,
  saveCommandText,
  saveProjectConfigText,
  serializeProjectConfig,
  uninstallSkill,
  getSkillDetail,
  findSkillReferences,
  updateSkillLockEntry,
  syncSkill,
  createSkill,
  updateSkillContent,
  validateProjectConfigYaml,
} from '@orion/config';
import type {
  Board,
  CreateProjectInput,
  InstallSkillInput,
  InstallSkillResult,
  Project,
  ProjectConfig,
  SkillCatalogEntry,
  SkillDetail,
  SkillLockEntry,
  SkillReference,
  SyncSkillResult,
  UpdateProjectInput,
  UpdateSkillInput,
} from '@orion/models';
import type { Container } from '../container.js';
import { WorkspaceService } from './workspace.service.js';

/**
 * Manages projects (each project is a repository) and derives the board and
 * agent configuration from the repo's `.orion/config.yaml`.
 */
export class ProjectService {
  private readonly workspaces: WorkspaceService;

  constructor(private readonly c: Container) {
    this.workspaces = new WorkspaceService(c);
  }

  list(): Promise<Project[]> {
    return this.c.projects.list();
  }

  get(id: string): Promise<Project | null> {
    return this.c.projects.get(id);
  }

  async create(input: CreateProjectInput & { configYaml?: string }): Promise<Project> {
    const yaml = input.configYaml ?? this.generateDefaultConfigYaml(input);
    const project = await this.c.projects.create({ ...input, configYaml: yaml });

    if (yaml) {
      try {
        const configRoot = await this.workspaces.resolveConfigRoot(project);
        await saveProjectConfigText(configRoot, yaml, project.configPath);
      } catch {
        // Config root may not be resolvable yet (e.g. remote repo not cloned).
        // The config is stored in the DB and can be written to disk later.
      }
    }
    return project;
  }

  private generateDefaultConfigYaml(input: CreateProjectInput): string {
    const defaultTemplate = getWorkflowTemplate('default');
    const config = {
      project: {
        name: input.name,
        defaultBranch: input.defaultBranch ?? 'main',
      },
      board: {
        swimlanes: defaultTemplate?.suggestedSwimlanes ?? ['backlog', 'in_progress', 'review', 'done'],
      },
      workflow: defaultTemplate?.workflow ?? {
        name: 'default',
        nodes: [],
      },
    };
    return serializeProjectConfig(config as import('@orion/models').ProjectConfig);
  }

  update(id: string, input: UpdateProjectInput): Promise<Project | null> {
    return this.c.projects.update(id, input);
  }

  delete(id: string): Promise<void> {
    return this.c.projects.delete(id);
  }

  /** Load and validate the project's Orion configuration. */
  async loadConfig(project: Project): Promise<ProjectConfig> {
    if (project.configYaml) {
      return loadProjectConfigFromYaml(project.configYaml);
    }
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return loadProjectConfig(configRoot, project.configPath);
  }

  /** Read the project's raw config YAML, or `null` if it does not exist yet. */
  async readConfigText(project: Project): Promise<string | null> {
    if (project.configYaml) {
      return project.configYaml;
    }
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return readProjectConfigText(configRoot, project.configPath);
  }

  /** Validate and persist raw config YAML to the project's config file. */
  async saveConfigText(project: Project, yaml: string): Promise<ProjectConfig> {
    const config = validateProjectConfigYaml(yaml);
    // Always store in the DB so multi-folder workspaces don't conflict.
    await this.c.projects.update(project.id, { configYaml: yaml });
    // Also write to disk for backward compatibility.
    try {
      const configRoot = await this.workspaces.resolveConfigRoot(project);
      await saveProjectConfigText(configRoot, yaml, project.configPath);
    } catch {
      // Config root not resolvable — DB is the source of truth.
    }
    return config;
  }

  /** Build the Kanban board from the configured columns and stored tickets. */
  async getBoard(project: Project): Promise<Board> {
    const config = await this.loadConfig(project);
    const board = this.c.boards.get(project.boardProvider);
    const b = await board.getBoard(project.id, config.board.swimlanes);
    return { ...b, issueTypes: resolveIssueTypes(config) };
  }

  /** List command template files (`.md`) under the project's `.orion/` dir. */
  async listCommandFiles(project: Project): Promise<string[]> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return listCommandFiles(configRoot, project.configPath);
  }

  /** Read a command template's text, or `null` if it does not exist yet. */
  async readCommandFile(project: Project, commandPath: string): Promise<string | null> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return readCommandText(configRoot, commandPath, project.configPath);
  }

  /** Write a command template's markdown text within the `.orion/` dir. */
  async saveCommandFile(project: Project, commandPath: string, content: string): Promise<void> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    await saveCommandText(configRoot, commandPath, content, project.configPath);
  }

  /** The project's skill catalog: built-in defaults plus installed skills. */
  async listSkills(project: Project): Promise<SkillCatalogEntry[]> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return listSkillCatalog(configRoot, project.configPath);
  }

  /** Get the full details and content of a single skill. */
  async getSkill(project: Project, name: string): Promise<SkillDetail | null> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return getSkillDetail(configRoot, name, project.configPath);
  }

  /** Install a skill from a GitHub repository into the project's `.orion/`. */
  async installSkill(project: Project, input: InstallSkillInput): Promise<InstallSkillResult> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return installSkillFromGitHub({
      ...input,
      repoDir: configRoot,
      configPath: project.configPath,
      scope: input.scope ?? 'project',
      token: this.c.env.githubToken,
    });
  }

  /** Remove an installed skill from the project's `.orion/`. */
  async uninstallSkill(project: Project, name: string): Promise<boolean> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return uninstallSkill(configRoot, name, project.configPath, 'project');
  }

  /** Update metadata (tags, syncEnabled) for an installed skill. */
  async updateSkill(project: Project, name: string, updates: UpdateSkillInput): Promise<SkillLockEntry | null> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return updateSkillLockEntry(configRoot, name, updates, project.configPath, 'project');
  }

  /** Sync an installed skill from its source repository. */
  async syncSkill(project: Project, name: string): Promise<SyncSkillResult> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return syncSkill(configRoot, name, project.configPath, 'project', this.c.env.githubToken);
  }

  /** Find workflow nodes that reference a given skill. */
  async getSkillReferences(project: Project, name: string): Promise<SkillReference[]> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return findSkillReferences(configRoot, name, project.configPath);
  }

  /** Create a new local skill under the project's `.orion/skills/` directory. */
  async createSkill(project: Project, name: string, description: string, content: string): Promise<void> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    await createSkill(configRoot, name, description, content, project.configPath, 'project');
  }

  /** Update an existing local skill's body content, preserving its frontmatter. */
  async updateSkillContent(
    project: Project,
    name: string,
    content: string,
    newName?: string,
    newDescription?: string,
  ): Promise<void> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    await updateSkillContent(configRoot, name, content, project.configPath, 'project', newName, newDescription);
  }
}
