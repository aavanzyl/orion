import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CreateReleaseInput,
  CreateTagInput,
  CreateWorktreeOptions,
  MergePullRequestInput,
  MergeResult,
  OpenPullRequestInput,
  PullRequest,
  PullRequestReview,
  Release,
  RepoRef,
  RequestReviewersInput,
  ResolveRepoOptions,
  ScmProvider,
  WorktreeHandle,
} from '@orion/scm-core';
import { git, gitRoot } from './git.js';

export interface GitHubScmOptions {
  /** GitHub token used for pull-request creation via the REST API. */
  token?: string;
  /** Base URL of the GitHub API (override for GitHub Enterprise). */
  apiBaseUrl?: string;
}

/** Derive a stable on-disk directory name from a repo URL. */
function repoDirName(repoUrl: string): string {
  const cleaned = repoUrl
    .replace(/\.git$/, '')
    .replace(/^git@[^:]+:/, '')
    .replace(/^https?:\/\/[^/]+\//, '');
  return cleaned.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

/** Extract `owner/repo` from an https or ssh GitHub remote URL. */
export function parseRepoSlug(repoUrl: string): { owner: string; repo: string } {
  const cleaned = repoUrl.replace(/\.git$/, '');
  const match = cleaned.match(/[/:]([^/:]+)\/([^/]+)$/);
  if (!match) {
    throw new Error(`Cannot parse owner/repo from "${repoUrl}"`);
  }
  return { owner: match[1], repo: match[2] };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * GitHub source-control adapter. Clones repositories into a managed workspace
 * and isolates each run in a disposable git worktree, then optionally opens a
 * pull request through the GitHub REST API.
 */
export class GitHubScmProvider implements ScmProvider {
  readonly key = 'github';

  constructor(private readonly options: GitHubScmOptions = {}) {}

  async resolveRepo(ref: RepoRef, options: ResolveRepoOptions): Promise<string> {
    if (ref.path) {
      if (!(await exists(join(ref.path, '.git')))) {
        throw new Error(`"${ref.path}" is not a git repository`);
      }
      return ref.path;
    }
    if (!ref.url) {
      throw new Error('RepoRef requires either a path or a url');
    }
    await mkdir(options.workspaceDir, { recursive: true });
    const repoPath = join(options.workspaceDir, repoDirName(ref.url));
    if (await exists(join(repoPath, '.git'))) {
      await git(repoPath, ['fetch', '--all', '--prune']);
    } else {
      await gitRoot(['clone', ref.url, repoPath]);
    }
    return repoPath;
  }

  async getDefaultBranch(repoPath: string): Promise<string> {
    // Prefer the remote's default branch; fall back to the current branch.
    const head = await git(repoPath, [
      'symbolic-ref',
      '--quiet',
      '--short',
      'refs/remotes/origin/HEAD',
    ]).catch(() => '');
    if (head) return head.replace(/^origin\//, '');
    return git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main');
  }

  async createWorktree(
    repoPath: string,
    options: CreateWorktreeOptions,
  ): Promise<WorktreeHandle> {
    const worktreePath =
      options.worktreePath ??
      join(repoPath, '..', '.worktrees', options.branch.replace(/[^a-zA-Z0-9._-]+/g, '-'));
    await mkdir(join(worktreePath, '..'), { recursive: true });

    const hasHead = await git(repoPath, ['rev-parse', '--verify', 'HEAD'])
      .then(() => true)
      .catch(() => false);
    if (!hasHead) {
      await git(repoPath, ['commit', '--allow-empty', '-m', 'Initial commit']);
    }

    await git(repoPath, ['worktree', 'add', '-b', options.branch, worktreePath, options.base]);

    return {
      path: worktreePath,
      branch: options.branch,
      cleanup: async () => {
        await git(repoPath, ['worktree', 'remove', '--force', worktreePath]).catch(() => undefined);
        await git(repoPath, ['branch', '-D', options.branch]).catch(() => undefined);
        await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
      },
    };
  }

  async hasChanges(worktreePath: string): Promise<boolean> {
    const status = await git(worktreePath, ['status', '--porcelain']);
    return status.length > 0;
  }

  async commitsAhead(worktreePath: string, base: string): Promise<number> {
    const out = await git(worktreePath, ['rev-list', '--count', `${base}..HEAD`]).catch(
      () => '0',
    );
    return Number.parseInt(out, 10) || 0;
  }

  async commitAll(worktreePath: string, message: string): Promise<void> {
    await git(worktreePath, ['add', '-A']);
    await git(worktreePath, ['commit', '-m', message]);
  }

  async push(worktreePath: string, branch: string): Promise<void> {
    await git(worktreePath, ['push', '-u', 'origin', branch]);
  }

  async openPullRequest(
    repoPath: string,
    input: OpenPullRequestInput,
  ): Promise<PullRequest> {
    const token = this.options.token;
    if (!token) {
      throw new Error('GitHub token is required to open a pull request');
    }
    const remote = await git(repoPath, ['remote', 'get-url', 'origin']);
    const { owner, repo } = parseRepoSlug(remote);
    const apiBaseUrl = this.options.apiBaseUrl ?? 'https://api.github.com';

    const response = await fetch(`${apiBaseUrl}/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub PR creation failed (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as { html_url: string; number: number };
    return { url: data.html_url, number: data.number };
  }

  async findPullRequest(repoPath: string, headBranch: string): Promise<PullRequest | null> {
    const { owner, repo } = await this.slug(repoPath);
    const query = `head=${encodeURIComponent(`${owner}:${headBranch}`)}&state=open`;
    const data = await this.githubFetch<Array<{ html_url: string; number: number }>>(
      `/repos/${owner}/${repo}/pulls?${query}`,
    );
    const pr = data[0];
    return pr ? { url: pr.html_url, number: pr.number } : null;
  }

  async createTag(repoPath: string, input: CreateTagInput): Promise<void> {
    const ref = input.ref ?? 'HEAD';
    if (input.message) {
      await git(repoPath, ['tag', '-a', input.tag, '-m', input.message, ref]);
    } else {
      await git(repoPath, ['tag', input.tag, ref]);
    }
    await git(repoPath, ['push', 'origin', input.tag]);
  }

  async createRelease(repoPath: string, input: CreateReleaseInput): Promise<Release> {
    const { owner, repo } = await this.slug(repoPath);
    const data = await this.githubFetch<{ html_url: string; id: number; tag_name: string }>(
      `/repos/${owner}/${repo}/releases`,
      {
        method: 'POST',
        body: {
          tag_name: input.tag,
          name: input.name ?? input.tag,
          body: input.body ?? '',
          target_commitish: input.target,
          draft: input.draft ?? false,
          prerelease: input.prerelease ?? false,
        },
      },
    );
    return { url: data.html_url, id: data.id, tag: data.tag_name };
  }

  async mergePullRequest(repoPath: string, input: MergePullRequestInput): Promise<MergeResult> {
    const { owner, repo } = await this.slug(repoPath);
    const data = await this.githubFetch<{ merged: boolean; sha?: string; message?: string }>(
      `/repos/${owner}/${repo}/pulls/${input.number}/merge`,
      {
        method: 'PUT',
        body: {
          merge_method: input.method ?? 'merge',
          commit_title: input.commitTitle,
          commit_message: input.commitMessage,
        },
      },
    );
    return { merged: data.merged, sha: data.sha, message: data.message };
  }

  async requestReviewers(repoPath: string, input: RequestReviewersInput): Promise<void> {
    const { owner, repo } = await this.slug(repoPath);
    await this.githubFetch(`/repos/${owner}/${repo}/pulls/${input.number}/requested_reviewers`, {
      method: 'POST',
      body: {
        reviewers: input.reviewers ?? [],
        team_reviewers: input.teamReviewers ?? [],
      },
    });
  }

  async listPullRequestReviews(repoPath: string, number: number): Promise<PullRequestReview[]> {
    const { owner, repo } = await this.slug(repoPath);
    const data = await this.githubFetch<Array<{ user: { login: string } | null; state: string }>>(
      `/repos/${owner}/${repo}/pulls/${number}/reviews`,
    );
    return data.map((r) => ({ user: r.user?.login ?? 'unknown', state: r.state }));
  }

  /** Resolve `owner/repo` from a worktree's `origin` remote. */
  private async slug(repoPath: string): Promise<{ owner: string; repo: string }> {
    const remote = await git(repoPath, ['remote', 'get-url', 'origin']);
    return parseRepoSlug(remote);
  }

  /** Authenticated GitHub REST helper. Throws on non-2xx responses. */
  private async githubFetch<T = unknown>(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const token = this.options.token;
    if (!token) {
      throw new Error('GitHub token is required for this operation');
    }
    const apiBaseUrl = this.options.apiBaseUrl ?? 'https://api.github.com';
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub API ${path} failed (${response.status}): ${detail}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
