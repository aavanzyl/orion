/**
 * Skills are reusable, self-contained instruction bundles (a folder with a
 * `SKILL.md` and optional supporting files) that follow the Claude/opencode
 * convention. Agents opt into skills by name; the orchestrator materializes the
 * selected skills into a run's isolated worktree so the harness discovers them
 * natively.
 *
 * A project's skill catalog is the union of Orion's built-in default skills and
 * any skills installed under `.orion/skills/`. Installed skills are recorded in
 * a lock file so a checkout is reproducible.
 */

/** Where a catalog entry comes from. */
export type SkillSource = 'builtin' | 'project';

/** Installation scope: available to all projects or a specific project. */
export type SkillScope = 'global' | 'project';

/** Parsed `SKILL.md` frontmatter. */
export interface SkillManifest {
  /** Lowercase, hyphen-separated identifier; matches the skill folder name. */
  name: string;
  /** One sentence covering what the skill does and when to use it. */
  description: string;
  /** Optional SDLC tags (plan, review, implement, etc.). */
  tags?: string[];
  /** Any additional frontmatter keys, preserved as-is. */
  metadata?: Record<string, string>;
}

/** A single entry in a project's skill catalog. */
export interface SkillCatalogEntry {
  name: string;
  description: string;
  /** `builtin` (shipped with Orion) or `project` (installed under `.orion/`). */
  source: SkillSource;
  /** True when a matching entry exists in `.orion/skills-lock.json`. */
  installed: boolean;
  /** `global` (available to all projects) or `project` (scoped to one project). */
  scope?: SkillScope;
  /** SDLC tags assigned to the skill. */
  tags?: string[];
  /** Link to the source repository (only for installed skills). */
  sourceUrl?: string;
  /** Whether periodic sync from the source repository is enabled. */
  syncEnabled?: boolean;
  /** ISO timestamp of the last successful sync. */
  lastSyncedAt?: string;
}

/** The complete content of a skill, returned when viewing a single skill. */
export interface SkillDetail extends SkillCatalogEntry {
  /** Raw content of the SKILL.md file (including frontmatter). */
  content: string;
}

/** Provenance recorded for an installed skill in `.orion/skills-lock.json`. */
export interface SkillLockEntry {
  /** Origin identifier, e.g. a GitHub repo URL. */
  source: string;
  /** How the skill was obtained. Only `github` is supported today. */
  sourceType: 'github';
  /** Path to the skill's `SKILL.md` within the source. */
  skillPath: string;
  /** Optional branch, tag, or commit the skill was installed from. */
  ref?: string;
  /** Deterministic sha256 of the installed skill's files, for integrity. */
  computedHash: string;
  /** User-assigned tags for this skill instance. */
  tags?: string[];
  /** Whether periodic sync from the source repository is enabled. */
  syncEnabled?: boolean;
  /** ISO timestamp of the last successful sync. */
  lastSyncedAt?: string;
}

/** The on-disk shape of `.orion/skills-lock.json`. */
export interface SkillLock {
  version: 1;
  skills: Record<string, SkillLockEntry>;
}

/** Options describing a skill to install from a GitHub repository. */
export interface InstallSkillInput {
  /** Full GitHub repository URL (e.g. https://github.com/owner/repo or git@github.com:owner/repo.git). */
  source: string;
  /** Path within the repo to the skill's SKILL.md, the skill directory, or a parent directory containing multiple skill subdirectories. */
  skillPath: string;
  /** Optional branch, tag, or commit to check out. Defaults to the repo default. */
  ref?: string;
  /** Optional user-assigned tags for this skill. */
  tags?: string[];
  /** Installation scope: `global` (default, available to all projects) or `project`. */
  scope?: SkillScope;
  /** Enable periodic sync from the source repository at install time. */
  syncEnabled?: boolean;
}

/** A single skill installed from a repository. */
export interface InstalledSkillResult {
  name: string;
  path: string;
  entry: SkillLockEntry;
}

/** Result of a security scan on a skill directory. */
export interface ScanResult {
  scanned: boolean;
  output?: string;
  issueCount?: number;
}

/** Full result of a skill installation, including scan results. */
export interface InstallSkillResult {
  skills: InstalledSkillResult[];
  scan: ScanResult;
}

/** Options for updating an installed skill's metadata. */
export interface UpdateSkillInput {
  /** User-assigned tags for this skill (replaces existing). */
  tags?: string[];
  /** Enable or disable periodic sync from the source repository. */
  syncEnabled?: boolean;
}

/** Result of syncing a skill from its source repository. */
export interface SyncSkillResult {
  /** Whether the sync made changes (new hash differs from old). */
  updated: boolean;
  /** The new computed hash after syncing. */
  computedHash: string;
  /** Whether the sync ran successfully. */
  success: boolean;
  /** Human-readable error if sync failed. */
  error?: string;
}

/**
 * A curated skill Orion recommends. Users can browse these and install them
 * with a single click; each carries the GitHub source coordinates needed to
 * install it, plus display metadata.
 */
export interface RecommendedSkill {
  /** Lowercase, hyphen-separated identifier; matches the installed skill name. */
  name: string;
  /** One sentence covering what the skill does and when to use it. */
  description: string;
  /** Full GitHub repository URL to install from. */
  source: string;
  /** Path within the repo to the skill's SKILL.md or directory. */
  skillPath: string;
  /** Optional branch, tag, or commit to install from. */
  ref?: string;
  /** SDLC tags describing the skill. */
  tags?: string[];
  /** Optional short attribution for the skill's author/publisher. */
  author?: string;
}

/** Describes a workflow node that references a skill. */
export interface SkillReference {
  /** ID of the workflow containing the reference. */
  workflowId: string;
  /** Name of the workflow (from config). */
  workflowName: string;
  /** ID of the node referencing the skill. */
  nodeId: string;
  /** Type of the referencing node. */
  nodeType: string;
}
