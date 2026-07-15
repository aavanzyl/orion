import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'yaml';
import type {
  SkillCatalogEntry,
  SkillDetail,
  SkillLock,
  SkillLockEntry,
  SkillManifest,
  SkillReference,
  SkillScope,
} from '@orion/models';
import { DEFAULT_CONFIG_PATH, loadProjectConfig } from './load-config.js';
import { ConfigError } from './errors.js';
import { BUILTIN_SKILLS, BUILTIN_SKILLS_BY_NAME } from './default-skills.js';

export const SKILLS_DIRNAME = 'skills';
export const SKILL_MANIFEST_FILENAME = 'SKILL.md';
export const SKILLS_LOCK_FILENAME = 'skills-lock.json';

/** Managed markers delimiting Orion's skill index inside a worktree AGENTS.md. */
const INDEX_START = '<!-- orion:skills:start -->';
const INDEX_END = '<!-- orion:skills:end -->';

/** The absolute `.orion/` directory (the config file's folder). */
function orionDir(repoDir: string, configPath: string): string {
  return resolve(join(repoDir, dirname(configPath)));
}

/** Root directory for global skills shared across all projects. */
export function globalSkillsRoot(): string {
  return resolve(process.env.ORION_GLOBAL_SKILLS_DIR ?? join(homedir(), '.orion'));
}

/** The absolute skills directory for a given scope. */
export function skillsDir(
  repoDir: string,
  configPath: string = DEFAULT_CONFIG_PATH,
  scope: SkillScope = 'project',
): string {
  if (scope === 'global') return join(globalSkillsRoot(), SKILLS_DIRNAME);
  return join(orionDir(repoDir, configPath), SKILLS_DIRNAME);
}

/** The absolute path to a skills-lock.json for a given scope. */
export function skillsLockPath(
  repoDir: string,
  configPath: string = DEFAULT_CONFIG_PATH,
  scope: SkillScope = 'project',
): string {
  if (scope === 'global') return join(globalSkillsRoot(), SKILLS_LOCK_FILENAME);
  return join(orionDir(repoDir, configPath), SKILLS_LOCK_FILENAME);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse the YAML frontmatter of a `SKILL.md` file into a manifest. Throws a
 * `ConfigError` when the frontmatter is missing or lacks a name/description.
 */
export function parseSkillManifest(markdown: string): SkillManifest {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown.replace(/^\uFEFF/, '').trimStart());
  if (!match) {
    throw new ConfigError('SKILL.md is missing YAML frontmatter');
  }

  let data: Record<string, unknown>;
  try {
    const parsed = parse(match[1]);
    data = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch (err) {
    throw new ConfigError('SKILL.md frontmatter is not valid YAML', [
      err instanceof Error ? err.message : String(err),
    ]);
  }

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (!name) throw new ConfigError('SKILL.md frontmatter is missing "name"');
  if (!description) throw new ConfigError('SKILL.md frontmatter is missing "description"');

  let tags: string[] | undefined;
  if (Array.isArray(data.tags)) {
    tags = data.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0) tags = undefined;
  } else if (typeof data.tags === 'string') {
    const trimmed = data.tags.trim();
    if (trimmed) tags = [trimmed];
  }

  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'name' || key === 'description' || key === 'tags') continue;
    if (typeof value === 'string') metadata[key] = value;
  }

  const result: SkillManifest = {
    name,
    description,
    ...(tags ? { tags } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
  return result;
}

/** Read a project's skills lock file, returning an empty lock when absent. */
export async function readSkillsLock(
  repoDir: string,
  configPath: string = DEFAULT_CONFIG_PATH,
  scope: SkillScope = 'project',
): Promise<SkillLock> {
  try {
    const raw = JSON.parse(await readFile(skillsLockPath(repoDir, configPath, scope), 'utf8')) as unknown;
    if (raw && typeof raw === 'object' && 'skills' in raw && (raw as SkillLock).skills) {
      return { version: 1, skills: (raw as SkillLock).skills };
    }
  } catch {
    // Missing or malformed lock: treat as empty.
  }
  return { version: 1, skills: {} };
}

/** Persist a project's skills lock file, creating the directory as needed. */
export async function writeSkillsLock(
  repoDir: string,
  lock: SkillLock,
  configPath: string = DEFAULT_CONFIG_PATH,
  scope: SkillScope = 'project',
): Promise<void> {
  const target = skillsLockPath(repoDir, configPath, scope);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

/** List the skills installed under a project's `.orion/skills/` directory. */
export async function listProjectSkills(
  repoDir: string,
  configPath: string = DEFAULT_CONFIG_PATH,
  scope: SkillScope = 'project',
): Promise<SkillCatalogEntry[]> {
  const dir = skillsDir(repoDir, configPath, scope);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const lock = await readSkillsLock(repoDir, configPath, scope);
  const out: SkillCatalogEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let text: string;
    try {
      text = await readFile(join(dir, entry.name, SKILL_MANIFEST_FILENAME), 'utf8');
    } catch {
      continue;
    }
    let manifest: SkillManifest;
    try {
      manifest = parseSkillManifest(text);
    } catch {
      continue;
    }
    const lockEntry = lock.skills[entry.name];
    const mergedTags = [...new Set([...(manifest.tags ?? []), ...(lockEntry?.tags ?? [])])];
    out.push({
      name: entry.name,
      description: manifest.description,
      source: 'project',
      installed: entry.name in lock.skills,
      scope,
      ...(mergedTags.length > 0 ? { tags: mergedTags } : {}),
      ...(lockEntry ? {
        sourceUrl: lockEntry.source,
        syncEnabled: lockEntry.syncEnabled,
        lastSyncedAt: lockEntry.lastSyncedAt,
      } : {}),
    });
  }
  return out;
}

/**
 * The full skill catalog for a project: Orion's built-in defaults plus any
 * global skills plus any skills installed under `.orion/skills/`. Project skills
 * override global skills, which override built-in. Sorted by name.
 */
export async function listSkillCatalog(
  repoDir: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<SkillCatalogEntry[]> {
  const byName = new Map<string, SkillCatalogEntry>();
  for (const builtin of BUILTIN_SKILLS) {
    byName.set(builtin.name, {
      name: builtin.name,
      description: builtin.description,
      source: 'builtin',
      installed: false,
      ...(builtin.tags ? { tags: builtin.tags } : {}),
    });
  }
  // Global skills layer over built-ins
  for (const global of await listProjectSkills(repoDir, configPath, 'global')) {
    byName.set(global.name, global);
  }
  // Project skills layer over global skills
  for (const project of await listProjectSkills(repoDir, configPath, 'project')) {
    byName.set(project.name, project);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** List only global skills (built-ins + global installed). */
export async function listGlobalSkillCatalog(): Promise<SkillCatalogEntry[]> {
  const byName = new Map<string, SkillCatalogEntry>();
  for (const builtin of BUILTIN_SKILLS) {
    byName.set(builtin.name, {
      name: builtin.name,
      description: builtin.description,
      source: 'builtin',
      installed: false,
      ...(builtin.tags ? { tags: builtin.tags } : {}),
    });
  }
  // Use an empty repoDir for global scope — skillsDir will use globalSkillsRoot()
  for (const global of await listProjectSkills('', '.orion/config.yaml', 'global')) {
    byName.set(global.name, global);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get the full details of a single skill, including its raw SKILL.md content.
 * Checks project skills first, then global skills, then built-ins.
 * Returns `null` if the skill is not found.
 */
export async function getSkillDetail(
  repoDir: string,
  name: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<SkillDetail | null> {
  // Try project scope first
  const projectDir = skillsDir(repoDir, configPath, 'project');
  let text: string;
  let scope: SkillScope = 'project';
  try {
    text = await readFile(join(projectDir, name, SKILL_MANIFEST_FILENAME), 'utf8');
  } catch {
    // Try global scope
    const globalDir = skillsDir(repoDir, configPath, 'global');
    try {
      text = await readFile(join(globalDir, name, SKILL_MANIFEST_FILENAME), 'utf8');
      scope = 'global';
    } catch {
      const builtin = BUILTIN_SKILLS_BY_NAME.get(name);
      if (!builtin) return null;
      return {
        name: builtin.name,
        description: builtin.description,
        source: 'builtin' as const,
        installed: false,
        tags: builtin.tags,
        content: builtin.content,
      };
    }
  }

  const manifest = parseSkillManifest(text);
  const lock = await readSkillsLock(repoDir, configPath, scope);
  const lockEntry = lock.skills[manifest.name];
  const mergedTags = [...new Set([...(manifest.tags ?? []), ...(lockEntry?.tags ?? [])])];
  return {
    name: manifest.name,
    description: manifest.description,
    source: 'project' as const,
    installed: manifest.name in lock.skills,
    scope,
    ...(mergedTags.length > 0 ? { tags: mergedTags } : {}),
    content: text,
    ...(lockEntry ? {
      sourceUrl: lockEntry.source,
      syncEnabled: lockEntry.syncEnabled,
      lastSyncedAt: lockEntry.lastSyncedAt,
    } : {}),
  };
}

/** Get skill detail from global skills only. */
export async function getGlobalSkillDetail(name: string): Promise<SkillDetail | null> {
  const dir = skillsDir('', '.orion/config.yaml', 'global');
  let text: string;
  try {
    text = await readFile(join(dir, name, SKILL_MANIFEST_FILENAME), 'utf8');
  } catch {
    const builtin = BUILTIN_SKILLS_BY_NAME.get(name);
    if (!builtin) return null;
    return {
      name: builtin.name,
      description: builtin.description,
      source: 'builtin' as const,
      installed: false,
      tags: builtin.tags,
      content: builtin.content,
    };
  }

  const manifest = parseSkillManifest(text);
  const lock = await readSkillsLock('', '.orion/config.yaml', 'global');
  const lockEntry = lock.skills[manifest.name];
  const mergedTags = [...new Set([...(manifest.tags ?? []), ...(lockEntry?.tags ?? [])])];
  return {
    name: manifest.name,
    description: manifest.description,
    source: 'project' as const,
    installed: manifest.name in lock.skills,
    scope: 'global',
    ...(mergedTags.length > 0 ? { tags: mergedTags } : {}),
    content: text,
    ...(lockEntry ? {
      sourceUrl: lockEntry.source,
      syncEnabled: lockEntry.syncEnabled,
      lastSyncedAt: lockEntry.lastSyncedAt,
    } : {}),
  };
}

/** A skill resolved to a concrete source ready to be materialized. */
export type ResolvedSkill =
  | { name: string; description: string; source: 'builtin'; content: string }
  | { name: string; description: string; source: 'project'; dir: string };

/**
 * Resolve a list of skill names against a project's catalog. Project skills take
 * precedence over built-ins. Throws a `ConfigError` listing any unknown names.
 */
export async function resolveSkills(
  repoDir: string,
  names: readonly string[],
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<ResolvedSkill[]> {
  const projectDir = skillsDir(repoDir, configPath, 'project');
  const globalDir = skillsDir(repoDir, configPath, 'global');
  const resolved: ResolvedSkill[] = [];
  const missing: string[] = [];

  for (const name of names) {
    // Try project skills first
    let text: string | null = null;
    let sourceDir: string | null = null;
    try {
      text = await readFile(join(projectDir, name, SKILL_MANIFEST_FILENAME), 'utf8');
      sourceDir = projectDir;
    } catch {
      // Try global skills
      try {
        text = await readFile(join(globalDir, name, SKILL_MANIFEST_FILENAME), 'utf8');
        sourceDir = globalDir;
      } catch {
        text = null;
      }
    }
    if (text && sourceDir) {
      const manifest = parseSkillManifest(text);
      resolved.push({ name, description: manifest.description, source: 'project', dir: join(sourceDir, name) });
      continue;
    }
    const builtin = BUILTIN_SKILLS_BY_NAME.get(name);
    if (builtin) {
      resolved.push({ name, description: builtin.description, source: 'builtin', content: builtin.content });
      continue;
    }
    missing.push(name);
  }

  if (missing.length > 0) {
    throw new ConfigError(
      'Agent references skills that are not in the catalog',
      missing.map((name) => `skill "${name}" not found (install it globally or under .orion/skills/)`),
    );
  }
  return resolved;
}

function buildIndexBlock(skills: readonly ResolvedSkill[]): string {
  const lines = [
    INDEX_START,
    '# Available Skills',
    '',
    'The following skills are available for this task. Before doing related work,',
    "read the referenced `SKILL.md` and follow its guidance.",
    '',
  ];
  for (const skill of skills) {
    lines.push(
      `- **${skill.name}** — ${skill.description} (see \`.orion/${SKILLS_DIRNAME}/${skill.name}/${SKILL_MANIFEST_FILENAME}\`)`,
    );
  }
  lines.push(INDEX_END);
  return lines.join('\n');
}

/**
 * Write (or refresh) the Orion-managed skills index in a worktree's `AGENTS.md`,
 * preserving any surrounding user content. The block is delimited by markers so
 * it can be regenerated idempotently.
 */
async function writeSkillsIndex(destRoot: string, skills: readonly ResolvedSkill[]): Promise<void> {
  const target = join(destRoot, 'AGENTS.md');
  let existing = '';
  try {
    existing = await readFile(target, 'utf8');
  } catch {
    existing = '';
  }

  const block = buildIndexBlock(skills);
  let next: string;
  if (existing.includes(INDEX_START) && existing.includes(INDEX_END)) {
    const pattern = new RegExp(`${escapeRegExp(INDEX_START)}[\\s\\S]*?${escapeRegExp(INDEX_END)}`);
    next = existing.replace(pattern, block);
  } else if (existing.trim().length > 0) {
    next = `${existing.trimEnd()}\n\n${block}\n`;
  } else {
    next = `${block}\n`;
  }
  await writeFile(target, next, 'utf8');
}

/**
 * Materialize resolved skills into a run's worktree so the harness discovers
 * them natively: each skill's files are copied to
 * `<destRoot>/.orion/skills/<name>/` and an index is written to the worktree's
 * `AGENTS.md`. Returns the names of the materialized skills.
 */
export async function materializeSkills(
  destRoot: string,
  skills: readonly ResolvedSkill[],
): Promise<string[]> {
  if (skills.length === 0) return [];

  const base = join(destRoot, '.orion', SKILLS_DIRNAME);
  const materialized: string[] = [];
  for (const skill of skills) {
    const dest = join(base, skill.name);
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    if (skill.source === 'builtin') {
      await writeFile(join(dest, SKILL_MANIFEST_FILENAME), skill.content, 'utf8');
    } else {
      await cp(skill.dir, dest, { recursive: true });
    }
    materialized.push(skill.name);
  }

  await writeSkillsIndex(destRoot, skills);
  return materialized;
}

/**
 * Convenience helper used by the orchestrator: resolve an agent's skill names
 * and materialize them into the run's worktree in one step.
 */
export async function installSkillsIntoWorktree(
  configRoot: string,
  worktreeRoot: string,
  skillNames: readonly string[] | undefined,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<string[]> {
  if (!skillNames || skillNames.length === 0) return [];
  const resolved = await resolveSkills(configRoot, skillNames, configPath);
  return materializeSkills(worktreeRoot, resolved);
}

/**
 * Find all workflow nodes that reference a given skill name by parsing the
 * project's config. Returns the workflow name, node id, and node type for each
 * match.
 */
export async function findSkillReferences(
  repoDir: string,
  skillName: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<SkillReference[]> {
  const references: SkillReference[] = [];

  let config;
  try {
    config = await loadProjectConfig(repoDir, configPath);
  } catch {
    return [];
  }

  const checkNodes = (
    nodes: Array<Record<string, unknown>>,
    workflowId: string,
    workflowName: string,
  ) => {
    for (const node of nodes) {
      const skills = node.skills;
      if (Array.isArray(skills) && skills.includes(skillName)) {
        references.push({
          workflowId,
          workflowName,
          nodeId: typeof node.id === 'string' ? node.id : '',
          nodeType: typeof node.type === 'string' ? node.type : 'agent',
        });
      }
    }
  };

  if (config.workflow) {
    checkNodes(config.workflow.nodes as unknown as Array<Record<string, unknown>>, 'default', config.workflow.name);
  }

  for (const [wfId, wf] of Object.entries(config.workflows ?? {})) {
    if (wf && typeof wf === 'object' && !Array.isArray(wf)) {
      checkNodes((wf as unknown as Record<string, unknown>).nodes as unknown as Array<Record<string, unknown>> ?? [], wfId, wfId);
    }
  }

  return references;
}

/**
 * Update an installed skill's lock entry with new metadata (tags, syncEnabled).
 * Returns the updated lock entry or null if the skill is not in the lock.
 */
export async function updateSkillLockEntry(
  repoDir: string,
  name: string,
  updates: { tags?: string[]; syncEnabled?: boolean },
  configPath: string = DEFAULT_CONFIG_PATH,
  scope: SkillScope = 'project',
): Promise<SkillLockEntry | null> {
  const lock = await readSkillsLock(repoDir, configPath, scope);
  const entry = lock.skills[name];
  if (!entry) return null;

  if (updates.tags !== undefined) {
    entry.tags = updates.tags.length > 0 ? updates.tags : undefined;
  }
  if (updates.syncEnabled !== undefined) {
    entry.syncEnabled = updates.syncEnabled;
  }

  await writeSkillsLock(repoDir, lock, configPath, scope);
  return entry;
}

/**
 * Create a new local skill by writing a SKILL.md with the given name,
 * description, and body content into the skills directory.
 */
export async function createSkill(
  repoDir: string,
  name: string,
  description: string,
  content: string,
  configPath: string = DEFAULT_CONFIG_PATH,
  scope: SkillScope = 'project',
): Promise<void> {
  const dir = skillsDir(repoDir, configPath, scope);
  const skillDir = join(dir, name);
  await mkdir(skillDir, { recursive: true });
  const frontmatter = `---\nname: ${name}\ndescription: ${description}\n---\n\n${content}`;
  await writeFile(join(skillDir, SKILL_MANIFEST_FILENAME), frontmatter, 'utf8');
}

/**
 * Update an existing local skill's body content, preserving the YAML
 * frontmatter. When `newName` or `newDescription` is provided the frontmatter
 * and directory name are also updated.
 */
export async function updateSkillContent(
  repoDir: string,
  name: string,
  content: string,
  configPath: string = DEFAULT_CONFIG_PATH,
  scope: SkillScope = 'project',
  newName?: string,
  newDescription?: string,
): Promise<void> {
  const dir = skillsDir(repoDir, configPath, scope);
  const skillDir = join(dir, name);
  const filePath = join(skillDir, SKILL_MANIFEST_FILENAME);
  const existing = await readFile(filePath, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(existing.replace(/^\uFEFF/, '').trimStart());
  if (!match) throw new ConfigError('SKILL.md is missing YAML frontmatter');

  let frontmatterYaml = match[1];
  if (newName) {
    frontmatterYaml = frontmatterYaml.replace(/^name:.*$/m, `name: ${newName}`);
  }
  if (newDescription) {
    if (/^description:.*$/m.test(frontmatterYaml)) {
      frontmatterYaml = frontmatterYaml.replace(/^description:.*$/m, `description: ${newDescription}`);
    } else {
      frontmatterYaml += `\ndescription: ${newDescription}`;
    }
  }

  const frontmatter = `---\n${frontmatterYaml}\n---`;
  await writeFile(filePath, `${frontmatter}\n\n${content}`, 'utf8');

  if (newName && newName !== name) {
    const newSkillDir = join(dir, newName);
    await rename(skillDir, newSkillDir);
  }
}

/**
 * Build YAML frontmatter text from a name and description for a SKILL.md.
 * Exported for use by the API layer.
 */
export function buildSkillFrontmatterText(
  name: string,
  description: string,
  content: string,
): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${content}`;
}
