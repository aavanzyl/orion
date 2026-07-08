import {
  installSkillFromGitHub,
  listCommandFiles,
  listSkillCatalog,
  loadProjectConfig,
  readCommandText,
  readProjectConfigText,
  saveCommandText,
  saveProjectConfigText,
  uninstallSkill,
  getSkillDetail,
  findSkillReferences,
  updateSkillLockEntry,
  syncSkill,
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

  create(input: CreateProjectInput): Promise<Project> {
    return this.c.projects.create(input);
  }

  update(id: string, input: UpdateProjectInput): Promise<Project | null> {
    return this.c.projects.update(id, input);
  }

  delete(id: string): Promise<void> {
    return this.c.projects.delete(id);
  }

  /** Load and validate the project's Orion configuration. */
  async loadConfig(project: Project): Promise<ProjectConfig> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return loadProjectConfig(configRoot, project.configPath);
  }

  /** Read the project's raw config YAML, or `null` if it does not exist yet. */
  async readConfigText(project: Project): Promise<string | null> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return readProjectConfigText(configRoot, project.configPath);
  }

  /** Validate and persist raw config YAML to the project's config file. */
  async saveConfigText(project: Project, yaml: string): Promise<ProjectConfig> {
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    return saveProjectConfigText(configRoot, yaml, project.configPath);
  }

  /** Build the Kanban board from the configured columns and stored tickets. */
  async getBoard(project: Project): Promise<Board> {
    const config = await this.loadConfig(project);
    const board = this.c.boards.get(project.boardProvider);
    return board.getBoard(project.id, config.board.swimlanes, config.board.triggers);
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
}
