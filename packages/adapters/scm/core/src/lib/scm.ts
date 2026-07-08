import type { Keyed } from '@orion/adapter-kit';
import { ProviderRegistry } from '@orion/adapter-kit';

/** A disposable, isolated checkout used for a single workflow run. */
export interface WorktreeHandle {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Branch checked out in the worktree. */
  branch: string;
  /** Remove the worktree and its branch. */
  cleanup(): Promise<void>;
}

/** Points a provider at a repository, either remote (clone) or local (existing). */
export interface RepoRef {
  /** Git URL to clone (remote sources). */
  url?: string;
  /** Absolute path to an existing local checkout (local/workspace sources). */
  path?: string;
}

export interface ResolveRepoOptions {
  /** Root directory where managed clones are stored (for remote sources). */
  workspaceDir: string;
}

export interface CreateWorktreeOptions {
  branch: string;
  /** Full git ref to branch from, e.g. `origin/main`, `main` or `HEAD`. */
  base: string;
  /** Directory to create the worktree in; defaults to a managed location. */
  worktreePath?: string;
}

export interface OpenPullRequestInput {
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface PullRequest {
  url: string;
  number?: number;
}

/** Create a git tag, and optionally a hosted release from it. */
export interface CreateTagInput {
  /** Tag name, e.g. `v1.2.3`. */
  tag: string;
  /** Annotated-tag message; when omitted a lightweight tag is created. */
  message?: string;
  /** Commit-ish the tag points at. Defaults to `HEAD`. */
  ref?: string;
}

export interface CreateReleaseInput {
  /** Tag the release is published from (created if missing). */
  tag: string;
  /** Human-readable release name; defaults to the tag. */
  name?: string;
  /** Markdown release notes. */
  body?: string;
  /** Commit-ish the tag/release targets. Defaults to `HEAD`. */
  target?: string;
  draft?: boolean;
  prerelease?: boolean;
}

export interface Release {
  url: string;
  id?: number;
  tag: string;
}

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface MergePullRequestInput {
  number: number;
  method?: MergeMethod;
  commitTitle?: string;
  commitMessage?: string;
}

export interface MergeResult {
  merged: boolean;
  sha?: string;
  message?: string;
}

export interface RequestReviewersInput {
  number: number;
  reviewers?: string[];
  teamReviewers?: string[];
}

export interface PullRequestReview {
  user: string;
  /** e.g. `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `PENDING`. */
  state: string;
}

/**
 * Source-control adapter (GitHub today; Bitbucket, GitLab later). Handles
 * cloning, git worktree isolation, commits and pull-request creation. It holds
 * no workflow or AI logic.
 */
export interface ScmProvider extends Keyed {
  /**
   * Resolve a repository to an on-disk path. Remote refs are cloned (or fetched
   * if already present); local refs are used in place. Returns the repo root.
   */
  resolveRepo(ref: RepoRef, options: ResolveRepoOptions): Promise<string>;
  /** The repository's default/base branch (used as the PR target). */
  getDefaultBranch(repoPath: string): Promise<string>;
  createWorktree(repoPath: string, options: CreateWorktreeOptions): Promise<WorktreeHandle>;
  hasChanges(worktreePath: string): Promise<boolean>;
  /** Number of commits on `branch` that are ahead of `base`. */
  commitsAhead(worktreePath: string, base: string): Promise<number>;
  commitAll(worktreePath: string, message: string): Promise<void>;
  push(worktreePath: string, branch: string): Promise<void>;
  openPullRequest(repoPath: string, input: OpenPullRequestInput): Promise<PullRequest>;
  /** Find an open pull request for a head branch, if any. */
  findPullRequest?(repoPath: string, headBranch: string): Promise<PullRequest | null>;
  /** Create (and push) a git tag. */
  createTag?(repoPath: string, input: CreateTagInput): Promise<void>;
  /** Publish a hosted release (creating the tag if needed). */
  createRelease?(repoPath: string, input: CreateReleaseInput): Promise<Release>;
  /** Merge a pull request. */
  mergePullRequest?(repoPath: string, input: MergePullRequestInput): Promise<MergeResult>;
  /** Request reviewers on a pull request. */
  requestReviewers?(repoPath: string, input: RequestReviewersInput): Promise<void>;
  /** List the reviews left on a pull request. */
  listPullRequestReviews?(repoPath: string, number: number): Promise<PullRequestReview[]>;
}

export class ScmRegistry extends ProviderRegistry<ScmProvider> {
  constructor() {
    super('scm');
  }
}
