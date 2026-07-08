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
  /** Absolute local path (used when `sourceKind` is `local` or `workspace`). */
  rootPath?: string;
  /** SCM adapter key, e.g. `github`. */
  scmProvider: string;
  /** Board adapter key, e.g. `native`. */
  boardProvider: string;
  defaultBranch: string;
  /** Path to the config file within the repo/workspace root. */
  configPath: string;
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
  scmProvider?: string;
  boardProvider?: string;
  defaultBranch?: string;
  configPath?: string;
}

/** Mutable fields of a project. All optional — only provided fields are changed. */
export interface UpdateProjectInput {
  name?: string;
  sourceKind?: ProjectSourceKind;
  repoUrl?: string;
  rootPath?: string;
  scmProvider?: string;
  boardProvider?: string;
  defaultBranch?: string;
  configPath?: string;
}
