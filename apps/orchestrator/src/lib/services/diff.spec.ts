import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { computeRunDiff } from './diff.js';

const execAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execAsync('git', args, { cwd });
  return stdout.trim();
}

async function getDefaultBranch(cwd: string): Promise<string> {
  return git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

async function setupRepo(): Promise<{ repoPath: string; baseBranch: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'orion-diff-test-'));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  };

  await execAsync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: dir });
  await execAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await execAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# initial');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-m', 'initial commit']);

  const baseBranch = await getDefaultBranch(dir);

  await writeFile(join(dir, 'app.ts'), 'console.log("v1")');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-m', 'base content']);

  await git(dir, ['checkout', '-b', 'feature']);
  await writeFile(join(dir, 'app.ts'), 'console.log("v2")');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-m', 'feature change']);

  return { repoPath: dir, baseBranch, cleanup };
}

describe('computeRunDiff', () => {
  let ctx: { repoPath: string; baseBranch: string; cleanup: () => Promise<void> };

  afterEach(async () => {
    if (ctx) await ctx.cleanup().catch(() => undefined);
  });

  it('returns diff text and untracked files relative to the base branch', async () => {
    ctx = await setupRepo();
    await writeFile(join(ctx.repoPath, 'untracked.log'), 'debug');

    const diff = await computeRunDiff(ctx.repoPath, ctx.baseBranch);

    expect(diff).toContain('app.ts');
    expect(diff).toContain('untracked.log');
    expect(diff.length).toBeGreaterThan(0);
  });

  it('returns empty string when there are no changes', async () => {
    ctx = await setupRepo();

    await git(ctx.repoPath, ['checkout', ctx.baseBranch]);
    const diff = await computeRunDiff(ctx.repoPath, ctx.baseBranch);

    expect(diff).toBe('');
  });

  it('returns only untracked files when working tree is clean but untracked files exist', async () => {
    ctx = await setupRepo();

    await git(ctx.repoPath, ['checkout', ctx.baseBranch]);
    await writeFile(join(ctx.repoPath, 'untracked-on-main.log'), 'data');
    const diff = await computeRunDiff(ctx.repoPath, ctx.baseBranch);

    expect(diff).toContain('untracked-on-main.log');
    expect(diff).not.toContain('app.ts');
  });

  it('returns only diff when there are no untracked files', async () => {
    ctx = await setupRepo();

    const diff = await computeRunDiff(ctx.repoPath, ctx.baseBranch);

    expect(diff).toContain('app.ts');
    expect(diff).not.toContain('?? ');
  });

  it('diffs against local base branch when it is ahead of origin/<base>', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orion-diff-local-ahead-'));
    const cleanup = async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    };
    ctx = { repoPath: '', baseBranch: 'main', cleanup };

    const originDir = await mkdtemp(join(tmpdir(), 'orion-diff-origin-'));
    const originCleanup = async () => {
      await rm(originDir, { recursive: true, force: true }).catch(() => undefined);
    };

    try {
      // Create a bare origin repo
      await execAsync('git', ['-c', 'init.defaultBranch=main', 'init', '--bare'], { cwd: originDir });

      // Clone it into the working dir
      await execAsync('git', ['clone', originDir, dir]);
      await execAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });

      // First commit and push to origin
      await writeFile(join(dir, 'base.ts'), 'export const x = 1');
      await git(dir, ['add', '-A']);
      await git(dir, ['commit', '-m', 'base']);
      await git(dir, ['push', 'origin', 'main']);

      // Second commit: local unpushed commits (simulating local ahead of origin)
      await writeFile(join(dir, 'local-ahead.ts'), 'export const y = 2');
      await git(dir, ['add', '-A']);
      await git(dir, ['commit', '-m', 'local unpushed']);

      // Create a run worktree from HEAD (as workspace.service does for local projects)
      await git(dir, ['checkout', '-b', 'orion/test-readme-slug']);
      await writeFile(join(dir, 'run-change.ts'), 'export const z = 3');
      await git(dir, ['add', '-A']);
      await git(dir, ['commit', '-m', 'run change']);

      ctx.repoPath = dir;
      ctx.baseBranch = 'main';

      const diff = await computeRunDiff(dir, 'main');

      // Should only show the run's own change, NOT the unpushed local-ahead.ts
      expect(diff).toContain('run-change.ts');
      expect(diff).not.toContain('local-ahead.ts');
      expect(diff).not.toContain('base.ts');
    } finally {
      await originCleanup();
    }
  });
});
