import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import type {
  InstallSkillInput,
  InstallSkillResult,
  InstalledSkillResult,
  ScanResult,
  SkillLockEntry,
  SkillScope,
  SyncSkillResult,
} from '@orion/models';
import { DEFAULT_CONFIG_PATH } from './load-config.js';
import { ConfigError } from './errors.js';
import {
  SKILL_MANIFEST_FILENAME,
  parseSkillManifest,
  readSkillsLock,
  skillsDir,
  writeSkillsLock,
} from './skills.js';

const run = promisify(execFile);

export interface InstallSkillOptions extends InstallSkillInput {
  /** Absolute path to the repository/workspace root holding `.orion/`. */
  repoDir: string;
  /** Config path relative to `repoDir` (defaults to `.orion/config.yaml`). */
  configPath?: string;
  /** Optional token for cloning a private GitHub repository over HTTPS. */
  token?: string;
}

/** Regex for validating a full GitHub repository URL. */
const GITHUB_URL_RE = /^(https:\/\/github\.com\/|git@github\.com:)[\w.-]+\/[\w.-]+(?:\.git)?$/;

function validateSource(source: string): void {
  if (!GITHUB_URL_RE.test(source)) {
    throw new ConfigError(
      `Invalid GitHub repository URL: "${source}". Provide a full URL like https://github.com/owner/repo or git@github.com:owner/repo.git`,
    );
  }
}

/** Build a clone URL, optionally injecting a token for HTTPS auth. */
function resolveCloneUrl(source: string, token?: string): string {
  if (token && source.startsWith('https://github.com/')) {
    return source.replace(/\.git$/, '.git').replace(
      'https://github.com/',
      `https://x-access-token:${token}@github.com/`,
    );
  }
  return source;
}

/** Recursively list files under a directory, as paths relative to it, sorted. */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        out.push(relative(dir, full));
      }
    }
  };
  await walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
}

/** Deterministic sha256 over a skill directory's files (content + layout). */
export async function hashSkillDir(dir: string): Promise<string> {
  const hash = createHash('sha256');
  for (const rel of await listFiles(dir)) {
    hash.update(rel);
    hash.update('\0');
    hash.update(await readFile(join(dir, rel)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Discover skill directories within a given path. Returns an array of
 * directory paths (relative to the given root) that contain a SKILL.md.
 * - If `rootPath` is a path to a SKILL.md, returns the parent directory.
 * - If `rootPath` is a directory containing SKILL.md, returns that directory.
 * - If `rootPath` is a directory with subdirectories that contain SKILL.md,
 *   returns all qualifying subdirectories.
 */
async function discoverSkillDirs(root: string, skillPath: string): Promise<string[]> {
  const target = join(root, skillPath.endsWith(SKILL_MANIFEST_FILENAME) ? dirname(skillPath) : skillPath);

  if (!(await isDirectory(target))) {
    throw new ConfigError(`Skill path "${skillPath}" was not found in the repository`);
  }

  const manifestPath = join(target, SKILL_MANIFEST_FILENAME);
  try {
    await stat(manifestPath);
    return [target];
  } catch {
    // target doesn't have SKILL.md directly — check subdirectories
  }

  const entries = await readdir(target, { withFileTypes: true });
  const skillDirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sub = join(target, entry.name);
    const subManifest = join(sub, SKILL_MANIFEST_FILENAME);
    try {
      await stat(subManifest);
      skillDirs.push(sub);
    } catch {
      // no SKILL.md in this subdirectory, skip
    }
  }

  if (skillDirs.length === 0) {
    throw new ConfigError(`No ${SKILL_MANIFEST_FILENAME} found at or under "${skillPath}" in the repository`);
  }

  return skillDirs;
}

/**
 * Run Snyk agent-scan on a skill directory. Returns a ScanResult describing
 * the outcome. If the tool is not installed the result will have `scanned: false`.
 */
async function scanSkillDir(dir: string): Promise<ScanResult> {
  try {
    const { stdout } = await run('npx', ['@snyk/agent-scan', dir], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    const match = stdout.match(/(\d+)\s+issues?\s+found/i);
    const issueCount = match ? Number.parseInt(match[1], 10) : 0;
    return { scanned: true, output: stdout.trim(), issueCount };
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr ?? '';
    const stdout = (err as { stdout?: string })?.stdout ?? '';
    if (stderr.includes('command not found') || stderr.includes('npm ERR!') || stdout.includes('npm ERR!')) {
      return { scanned: false };
    }
    return { scanned: true, output: (stdout || stderr).trim(), issueCount: 1 };
  }
}

/**
 * Install skills from a GitHub repository into `.orion/skills/<name>/` and
 * record them in `.orion/skills-lock.json`.
 *
 * `skillPath` can be:
 *   - A path to a `SKILL.md` file (the containing directory is installed).
 *   - A path to a skill directory (the directory itself).
 *   - A path to a parent directory with many skill subdirectories (each one that
 *     contains a `SKILL.md` is installed as a separate skill).
 *
 * Before installing, the skill directory is scanned with Snyk agent-scan to
 * detect potentially malicious content.
 */
export async function installSkillFromGitHub(
  options: InstallSkillOptions,
): Promise<InstallSkillResult> {
  const { repoDir, source, skillPath, ref, tags: inputTags, scope = 'global', syncEnabled, token } = options;
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;

  validateSource(source);

  const temp = await mkdtemp(join(tmpdir(), 'orion-skill-'));
  try {
    const url = resolveCloneUrl(source, token);
    try {
      await run('git', ['clone', '--depth', '1', url, temp]);
      if (ref) {
        await run('git', ['-C', temp, 'fetch', '--depth', '1', 'origin', ref]);
        await run('git', ['-C', temp, 'checkout', 'FETCH_HEAD']);
      }
    } catch (err) {
      throw new ConfigError(`Failed to clone skill source "${source}"`, [
        err instanceof Error ? err.message : String(err),
      ]);
    }

    const discovered = await discoverSkillDirs(temp, skillPath);

    const lock = await readSkillsLock(repoDir, configPath, scope);
    const installed: InstalledSkillResult[] = [];

    let scan: ScanResult = { scanned: false };

    for (const skillDir of discovered) {
      const manifestText = await readFile(join(skillDir, SKILL_MANIFEST_FILENAME), 'utf8');
      const manifest = parseSkillManifest(manifestText);
      const name = manifest.name || basename(skillDir);

      const dest = join(skillsDir(repoDir, configPath, scope), name);
      await rm(dest, { recursive: true, force: true });
      await mkdir(dirname(dest), { recursive: true });
      await cp(skillDir, dest, { recursive: true });

      const entry: SkillLockEntry = {
        source,
        sourceType: 'github',
        skillPath: relative(temp, skillDir),
        ...(ref ? { ref } : {}),
        computedHash: await hashSkillDir(dest),
        ...(inputTags?.length ? { tags: inputTags } : {}),
        ...(syncEnabled !== undefined ? { syncEnabled } : {}),
      };

      lock.skills[name] = entry;
      installed.push({ name, path: relative(repoDir, dest), entry });
    }

    // Run the scan on the first discovered skill's directory (or the only one).
    // For multi-skill parent dirs we scan each skill subdirectory and merge.
    if (discovered.length === 1) {
      scan = await scanSkillDir(discovered[0]);
    } else if (discovered.length > 1) {
      let combinedOutput = '';
      let totalIssues = 0;
      let anyScanned = false;
      for (const dir of discovered) {
        const result = await scanSkillDir(dir);
        if (result.scanned) {
          anyScanned = true;
          totalIssues += result.issueCount ?? 0;
          combinedOutput += `${basename(dir)}:\n${result.output ?? ''}\n\n`;
        }
      }
      scan = anyScanned
        ? { scanned: true, output: combinedOutput.trim(), issueCount: totalIssues }
        : { scanned: false };
    }

    await writeSkillsLock(repoDir, lock, configPath, scope);

    return { skills: installed, scan };
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Sync an installed skill from its source repository. Re-clones the source,
 * computes a new hash, and updates the skill directory if the content changed.
 * Only works for skills installed via GitHub.
 */
export async function syncSkill(
  repoDir: string,
  name: string,
  configPath: string = DEFAULT_CONFIG_PATH,
  scope: SkillScope = 'global',
  token?: string,
): Promise<SyncSkillResult> {
  const lock = await readSkillsLock(repoDir, configPath, scope);
  const entry = lock.skills[name];
  if (!entry) {
    return { updated: false, computedHash: '', success: false, error: 'Skill not found in lock' };
  }
  if (entry.sourceType !== 'github') {
    return { updated: false, computedHash: entry.computedHash, success: false, error: 'Only GitHub-sourced skills can be synced' };
  }

  const temp = await mkdtemp(join(tmpdir(), 'orion-skill-sync-'));
  try {
    const url = resolveCloneUrl(entry.source, token);
    try {
      await run('git', ['clone', '--depth', '1', url, temp]);
      if (entry.ref) {
        await run('git', ['-C', temp, 'fetch', '--depth', '1', 'origin', entry.ref]);
        await run('git', ['-C', temp, 'checkout', 'FETCH_HEAD']);
      }
    } catch (err) {
      return {
        updated: false,
        computedHash: entry.computedHash,
        success: false,
        error: `Failed to clone source: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const skillDir = join(temp, entry.skillPath);
    if (!(await isDirectory(skillDir))) {
      try {
        await stat(join(skillDir, SKILL_MANIFEST_FILENAME));
      } catch {
        return {
          updated: false,
          computedHash: entry.computedHash,
          success: false,
          error: 'Skill directory no longer exists at the recorded path in the source',
        };
      }
    }

    await cp(skillDir, temp, { recursive: true });
    const newHash = await hashSkillDir(temp);

    if (newHash === entry.computedHash) {
      entry.lastSyncedAt = new Date().toISOString();
      await writeSkillsLock(repoDir, lock, configPath, scope);
      return { updated: false, computedHash: newHash, success: true };
    }

    const dest = join(skillsDir(repoDir, configPath, scope), name);
    await rm(dest, { recursive: true, force: true });
    await mkdir(dirname(dest), { recursive: true });
    await cp(skillDir, dest, { recursive: true });

    entry.computedHash = newHash;
    entry.lastSyncedAt = new Date().toISOString();
    await writeSkillsLock(repoDir, lock, configPath, scope);

    return { updated: true, computedHash: newHash, success: true };
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Remove an installed skill's files and its lock entry. */
export async function uninstallSkill(
  repoDir: string,
  name: string,
  configPath: string = DEFAULT_CONFIG_PATH,
  scope: SkillScope = 'global',
): Promise<boolean> {
  const lock = await readSkillsLock(repoDir, configPath, scope);
  const known = name in lock.skills;
  await rm(join(skillsDir(repoDir, configPath, scope), name), { recursive: true, force: true });
  if (known) {
    delete lock.skills[name];
    await writeSkillsLock(repoDir, lock, configPath, scope);
  }
  return known;
}
