import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git } from './git.js';
import { GitHubScmProvider } from './github-scm.js';

const tmpBase = join(__dirname, '..', '..', 'test-tmp');

async function createEmptyRepo(name: string): Promise<string> {
  const path = join(tmpBase, name);
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(path, { recursive: true });
  return path;
}

async function initGitRepo(path: string, withCommit = false): Promise<void> {
  await git(path, ['init']);
  if (withCommit) {
    await writeFile(join(path, 'README.md'), '# test');
    await git(path, ['add', '-A']);
    await git(path, ['commit', '-m', 'Initial commit']);
  }
}

describe('GitHubScmProvider', () => {
  const provider = new GitHubScmProvider();

  describe('createWorktree', () => {
    it('creates a worktree from a repo that has commits', async () => {
      const origin = await createEmptyRepo('with-commits');
      await initGitRepo(origin, true);

      const worktreePath = join(tmpBase, 'worktree-with-commits');
      await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);

      const handle = await provider.createWorktree(origin, {
        branch: 'test/feature',
        base: 'HEAD',
        worktreePath,
      });

      expect(handle.path).toBe(worktreePath);
      expect(handle.branch).toBe('test/feature');

      const branches = await git(origin, ['branch', '--list', 'test/feature']);
      expect(branches).toContain('test/feature');

      await handle.cleanup();
    });

    it('creates a worktree from a repo with no commits by creating an initial commit first', async () => {
      const origin = await createEmptyRepo('no-commits');
      await initGitRepo(origin, false);

      const worktreePath = join(tmpBase, 'worktree-no-commits');
      await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);

      const handle = await provider.createWorktree(origin, {
        branch: 'test/feature',
        base: 'HEAD',
        worktreePath,
      });

      expect(handle.path).toBe(worktreePath);
      expect(handle.branch).toBe('test/feature');

      await handle.cleanup();
    });
  });

  describe('commitAll', () => {
    it('commits changes and the commit is recorded in the log', async () => {
      const repo = await createEmptyRepo('commit-test');
      await initGitRepo(repo, true);

      await writeFile(join(repo, 'new-file.txt'), 'hello');
      await provider.commitAll(repo, 'test commit message');

      const log = await git(repo, ['log', '--oneline', '-1']);
      expect(log).toContain('test commit message');
    });

    it('commits successfully without git user identity configured', async () => {
      const repo = await createEmptyRepo('commit-no-identity');
      await initGitRepo(repo, true);

      // Remove local identity config so the identity fallback is exercised.
      // git config --unset only removes one level; try global then local.
      await git(repo, ['config', '--local', 'user.name', '']).catch(() => undefined);
      await git(repo, ['config', '--local', 'user.email', '']).catch(() => undefined);

      await writeFile(join(repo, 'another-file.txt'), 'world');
      await provider.commitAll(repo, 'no-identity commit');

      const log = await git(repo, ['log', '--oneline', '-1']);
      expect(log).toContain('no-identity commit');
    });

    it('creates a worktree from empty repo without identity config', async () => {
      const origin = await createEmptyRepo('no-id-worktree');
      await initGitRepo(origin, false);

      // Remove local identity config so the identity fallback is exercised.
      await git(origin, ['config', '--local', 'user.name', '']).catch(() => undefined);
      await git(origin, ['config', '--local', 'user.email', '']).catch(() => undefined);

      const worktreePath = join(tmpBase, 'worktree-no-id');
      await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);

      const handle = await provider.createWorktree(origin, {
        branch: 'test/no-id',
        base: 'HEAD',
        worktreePath,
      });

      expect(handle.path).toBe(worktreePath);
      await handle.cleanup();
    });
  });
});
