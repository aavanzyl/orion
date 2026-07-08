import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseProjectConfig } from './load-config.js';
import { ConfigError } from './errors.js';
import {
  getSkillDetail,
  listSkillCatalog,
  materializeSkills,
  parseSkillManifest,
  readSkillsLock,
  resolveSkills,
  skillsDir,
  writeSkillsLock,
} from './skills.js';
import { uninstallSkill } from './skill-install.js';

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'orion-skills-test-'));
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function writeProjectSkill(name: string, frontmatter: string, body = '# Body\n'): Promise<void> {
  const dir = join(skillsDir(repo), name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}`, 'utf8');
}

describe('parseSkillManifest', () => {
  it('parses name and description from frontmatter', () => {
    const manifest = parseSkillManifest('---\nname: my-skill\ndescription: Does a thing.\n---\n\n# Body');
    expect(manifest.name).toBe('my-skill');
    expect(manifest.description).toBe('Does a thing.');
  });

  it('collects extra frontmatter into metadata', () => {
    const manifest = parseSkillManifest(
      '---\nname: s\ndescription: d\nlicense: MIT\n---\nbody',
    );
    expect(manifest.metadata).toEqual({ license: 'MIT' });
  });

  it('parses tags as an array', () => {
    const manifest = parseSkillManifest(
      '---\nname: s\ndescription: d\ntags: [plan, review]\n---\nbody',
    );
    expect(manifest.tags).toEqual(['plan', 'review']);
  });

  it('parses a single tag string as an array', () => {
    const manifest = parseSkillManifest(
      '---\nname: s\ndescription: d\ntags: implement\n---\nbody',
    );
    expect(manifest.tags).toEqual(['implement']);
  });

  it('omits tags when not present', () => {
    const manifest = parseSkillManifest(
      '---\nname: s\ndescription: d\n---\nbody',
    );
    expect(manifest.tags).toBeUndefined();
  });

  it('throws when frontmatter is missing', () => {
    expect(() => parseSkillManifest('# no frontmatter')).toThrow(ConfigError);
  });

  it('throws when name is missing', () => {
    expect(() => parseSkillManifest('---\ndescription: d\n---\nbody')).toThrow(/name/);
  });
});

describe('listSkillCatalog', () => {
  it('includes the built-in default skills', async () => {
    const catalog = await listSkillCatalog(repo);
    const names = catalog.map((s) => s.name);
    expect(names).toContain('conventional-commits');
    expect(catalog.every((s) => s.description.length > 0)).toBe(true);
  });

  it('built-in skills have tags', async () => {
    const catalog = await listSkillCatalog(repo);
    const cc = catalog.find((s) => s.name === 'conventional-commits');
    expect(cc?.tags).toBeDefined();
    expect(cc!.tags!.length).toBeGreaterThan(0);
  });

  it('merges project skills and lets them override built-ins', async () => {
    await writeProjectSkill('conventional-commits', 'name: conventional-commits\ndescription: Project override.');
    await writeProjectSkill('local-only', 'name: local-only\ndescription: A project skill.');
    const catalog = await listSkillCatalog(repo);
    const override = catalog.find((s) => s.name === 'conventional-commits');
    expect(override?.source).toBe('project');
    expect(override?.description).toBe('Project override.');
    expect(catalog.find((s) => s.name === 'local-only')?.source).toBe('project');
  });

  it('includes tags from project skills', async () => {
    await writeProjectSkill('tagged', 'name: tagged\ndescription: d\ntags: [plan, implement]\n');
    const catalog = await listSkillCatalog(repo);
    const s = catalog.find((sk) => sk.name === 'tagged');
    expect(s?.tags).toEqual(['plan', 'implement']);
  });
});

describe('getSkillDetail', () => {
  it('returns full detail for a built-in skill', async () => {
    const detail = await getSkillDetail(repo, 'conventional-commits');
    expect(detail).not.toBeNull();
    expect(detail!.name).toBe('conventional-commits');
    expect(detail!.source).toBe('builtin');
    expect(detail!.content).toContain('name: conventional-commits');
    expect(detail!.content).toContain('# Conventional Commits');
    expect(detail!.tags).toBeDefined();
  });

  it('returns full detail for a project skill', async () => {
    await writeProjectSkill('my-skill', 'name: my-skill\ndescription: d\ntags: [review]\n', '# Skill body\n');
    const detail = await getSkillDetail(repo, 'my-skill');
    expect(detail).not.toBeNull();
    expect(detail!.name).toBe('my-skill');
    expect(detail!.source).toBe('project');
    expect(detail!.content).toContain('# Skill body');
    expect(detail!.tags).toEqual(['review']);
  });

  it('returns null for unknown skill', async () => {
    const detail = await getSkillDetail(repo, 'nonexistent');
    expect(detail).toBeNull();
  });
});

describe('resolveSkills / materializeSkills', () => {
  it('materializes a built-in skill and writes an AGENTS.md index', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'orion-wt-'));
    try {
      const resolved = await resolveSkills(repo, ['conventional-commits']);
      const names = await materializeSkills(worktree, resolved);
      expect(names).toEqual(['conventional-commits']);

      const skill = await readFile(
        join(worktree, '.orion', 'skills', 'conventional-commits', 'SKILL.md'),
        'utf8',
      );
      expect(skill).toContain('name: conventional-commits');

      const agents = await readFile(join(worktree, 'AGENTS.md'), 'utf8');
      expect(agents).toContain('conventional-commits');
      expect(agents).toContain('orion:skills:start');
    } finally {
      await rm(worktree, { recursive: true, force: true });
    }
  });

  it('preserves existing AGENTS.md content and is idempotent', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'orion-wt-'));
    try {
      await writeFile(join(worktree, 'AGENTS.md'), '# Repo Guide\n\nKeep me.\n', 'utf8');
      const resolved = await resolveSkills(repo, ['pr-description']);
      await materializeSkills(worktree, resolved);
      await materializeSkills(worktree, resolved);
      const agents = await readFile(join(worktree, 'AGENTS.md'), 'utf8');
      expect(agents).toContain('Keep me.');
      expect(agents.match(/orion:skills:start/g)).toHaveLength(1);
    } finally {
      await rm(worktree, { recursive: true, force: true });
    }
  });

  it('prefers a project skill over a built-in of the same name', async () => {
    await writeProjectSkill('pr-description', 'name: pr-description\ndescription: Custom.', '# Custom body\n');
    const worktree = await mkdtemp(join(tmpdir(), 'orion-wt-'));
    try {
      const resolved = await resolveSkills(repo, ['pr-description']);
      expect(resolved[0].source).toBe('project');
      await materializeSkills(worktree, resolved);
      const skill = await readFile(
        join(worktree, '.orion', 'skills', 'pr-description', 'SKILL.md'),
        'utf8',
      );
      expect(skill).toContain('# Custom body');
    } finally {
      await rm(worktree, { recursive: true, force: true });
    }
  });

  it('throws a ConfigError listing unknown skills', async () => {
    await expect(resolveSkills(repo, ['does-not-exist'])).rejects.toThrow(ConfigError);
  });
});

describe('skills lock', () => {
  it('reads an empty lock when none exists', async () => {
    const lock = await readSkillsLock(repo);
    expect(lock).toEqual({ version: 1, skills: {} });
  });

  it('round-trips a lock and uninstall removes files and the entry', async () => {
    await writeProjectSkill('installed-skill', 'name: installed-skill\ndescription: d');
    await writeSkillsLock(repo, {
      version: 1,
      skills: {
        'installed-skill': {
          source: 'owner/repo',
          sourceType: 'github',
          skillPath: 'skills/installed-skill/SKILL.md',
          computedHash: 'abc',
        },
      },
    });

    const catalog = await listSkillCatalog(repo);
    expect(catalog.find((s) => s.name === 'installed-skill')?.installed).toBe(true);

    const removed = await uninstallSkill(repo, 'installed-skill', '.orion/config.yaml', 'project');
    expect(removed).toBe(true);
    expect((await readSkillsLock(repo, '.orion/config.yaml', 'project')).skills['installed-skill']).toBeUndefined();
  });
});

describe('agent skills config', () => {
  it('accepts a skills array on an agent node', () => {
    const config = parseProjectConfig(`
project: { name: c, defaultBranch: main }
board: { swimlanes: [x] }
workflow:
  name: default
  nodes:
    - id: n1
      type: agent
      provider: codex
      skills: [conventional-commits, pr-description]
      swimlane: x
`);
    expect(config.workflow.nodes[0].skills).toEqual(['conventional-commits', 'pr-description']);
  });
});
