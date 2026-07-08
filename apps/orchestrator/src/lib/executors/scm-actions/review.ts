import type { PullRequestReview } from '@orion/scm-core';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import type { ScmAction } from './types.js';

interface UpstreamPullRequest {
  repo: string;
  pr: { url: string; number?: number };
}

/** Extract PR numbers from an upstream `open_pull_request` node output shape. */
function pullRequestNumberFromOutputs(nodeOutputs: Record<string, unknown>): number | undefined {
  for (const value of Object.values(nodeOutputs)) {
    if (!value || typeof value !== 'object') continue;
    const prs = (value as { pullRequests?: unknown }).pullRequests;
    if (!Array.isArray(prs)) continue;
    for (const entry of prs as UpstreamPullRequest[]) {
      const number = entry?.pr?.number;
      if (typeof number === 'number') return number;
    }
  }
  return undefined;
}

/** Resolve the target PR number from node config, else an upstream PR output. */
function resolvePrNumber(ctx: NodeExecutionContext, config: Record<string, unknown>): number | undefined {
  if (typeof config.pr === 'number') return config.pr;
  return pullRequestNumberFromOutputs(ctx.nodeOutputs);
}

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? (value as string[])
    : undefined;

/**
 * `review`: optionally request reviewers on a pull request, then summarize its
 * current review state. When `config.requireApproval` is true the action gates:
 * it fails unless the PR has an approving review and no requested changes.
 *
 * Config keys (from `ctx.nodeConfig.config`):
 * - `pr?` (number) — target PR; otherwise resolved from an upstream
 *   `open_pull_request` node output via `ctx.nodeOutputs`.
 * - `reviewers?` (string[]) — user reviewers to request.
 * - `teamReviewers?` (string[]) — team reviewers to request.
 * - `requireApproval?` (boolean) — when true, gate on an approving review.
 */
export const review: ScmAction = async (ctx, { scm }) => {
  const config = (ctx.nodeConfig.config ?? {}) as Record<string, unknown>;

  const canRequest = typeof scm.requestReviewers === 'function';
  const canList = typeof scm.listPullRequestReviews === 'function';
  if (!canRequest && !canList) {
    return { status: 'failed', error: 'scm provider does not support reviews' };
  }

  const repo = ctx.workspace.repos[0];
  if (!repo) {
    return { status: 'failed', error: 'review: no repos in the workspace' };
  }

  const number = resolvePrNumber(ctx, config);
  if (typeof number !== 'number') {
    return { status: 'failed', error: 'review: could not resolve a pull request number' };
  }

  const reviewers = asStringArray(config.reviewers);
  const teamReviewers = asStringArray(config.teamReviewers);
  const requireApproval = config.requireApproval === true;

  try {
    const requested: string[] = [];
    if ((reviewers || teamReviewers) && typeof scm.requestReviewers === 'function') {
      await scm.requestReviewers(repo.originPath, { number, reviewers, teamReviewers });
      requested.push(...(reviewers ?? []), ...(teamReviewers ?? []));
      await ctx.emit('log', {
        message: `Requested reviewers on PR #${number}: ${requested.join(', ')}`,
      });
    }

    let reviews: PullRequestReview[] = [];
    if (typeof scm.listPullRequestReviews === 'function') {
      reviews = await scm.listPullRequestReviews(repo.originPath, number);
      await ctx.emit('log', { message: `PR #${number} has ${reviews.length} review(s)` });
    }

    const approved = reviews.some((r) => r.state === 'APPROVED');
    const changesRequested = reviews.some((r) => r.state === 'CHANGES_REQUESTED');

    const summary = { number, requested, reviews, approved, changesRequested };

    if (requireApproval && (!approved || changesRequested)) {
      await ctx.emit('log', {
        message: `PR #${number} does not meet approval requirements`,
      });
      return {
        status: 'failed',
        error: changesRequested
          ? `review: PR #${number} has requested changes`
          : `review: PR #${number} is not approved`,
      };
    }

    return { status: 'completed', output: summary };
  } catch (err) {
    return {
      status: 'failed',
      error: `review failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
