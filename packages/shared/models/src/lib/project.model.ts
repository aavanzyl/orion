export type ProjectId = string;

/**
 * How a project's source is obtained.
 * - `remote`    — a git URL that Orion clones and manages.
 * - `local`     — an existing local checkout of a single repository.
 * - `workspace` — a local parent folder containing multiple repositories that
 *                 share a single board, config and goal.
 */
export type ProjectSourceKind = 'remote' | 'local' | 'workspace';

export interface Project {
  id: ProjectId;
  name: string;
  sourceKind: ProjectSourceKind;
  /** Git remote URL (used when `sourceKind` is `remote`). */
  repoUrl: string;
  /** Absolute local path (used when `sourceKind` is `local`). */
  rootPath?: string;
  /** Absolute local paths for each folder in a multi-folder workspace. */
  paths?: string[];
  /** SCM adapter key, e.g. `github`. */
  scmProvider: string;
  /** Board adapter key, e.g. `native`. */
  boardProvider: string;
  defaultBranch: string;
  /** Path to the config file within the repo/workspace root (file-based config). */
  configPath: string;
  /** Raw YAML config stored in the database (DB-based config). */
  configYaml?: string | null;
  /** Auto-incrementing counter for JIRA-style ticket keys (e.g. ORION-42). */
  ticketCounter?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  sourceKind?: ProjectSourceKind;
  repoUrl?: string;
  rootPath?: string;
  /** Folder paths for a multi-folder workspace. */
  paths?: string[];
  scmProvider?: string;
  boardProvider?: string;
  defaultBranch?: string;
  configPath?: string;
  /** Raw YAML config to store in the DB (DB-based config). */
  configYaml?: string;
}

/** Mutable fields of a project. All optional — only provided fields are changed. */
export interface UpdateProjectInput {
  name?: string;
  sourceKind?: ProjectSourceKind;
  repoUrl?: string;
  rootPath?: string;
  /** Folder paths for a multi-folder workspace. */
  paths?: string[];
  scmProvider?: string;
  boardProvider?: string;
  defaultBranch?: string;
  configPath?: string;
  /** Raw YAML config to store in the DB (DB-based config). */
  configYaml?: string;
}
