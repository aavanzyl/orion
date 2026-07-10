import { describe, expect, it, vi } from 'vitest';
import type { PullRequestReview, ScmProvider } from '@orion/scm-core';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import type { TicketRepository } from '@orion/db';
import { review } from './review.js';

function makeCtx(
  config: Record<string, unknown> = {},
  nodeOutputs: Record<string, unknown> = {},
): { ctx: NodeExecutionContext; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    nodeConfig: { id: 'r1', type: 'scm', action: 'review', config },
    workspace: {
      repos: [{ name: 'app', path: '/wt/app', originPath: '/origin/app', branch: 'feat', baseBranch: 'main' }],
    },
    nodeOutputs,
    emit,
  } as unknown as NodeExecutionContext;
  return { ctx, emit };
}

function fakeScm(
  overrides: Partial<ScmProvider> = {},
): ScmProvider & {
  requestReviewers: ReturnType<typeof vi.fn>;
  listPullRequestReviews: ReturnType<typeof vi.fn>;
} {
  return {
    requestReviewers: vi.fn().mockResolvedValue(undefined),
    listPullRequestReviews: vi.fn().mockResolvedValue([] as PullRequestReview[]),
    ...overrides,
  } as unknown as ScmProvider & {
    requestReviewers: ReturnType<typeof vi.fn>;
    listPullRequestReviews: ReturnType<typeof vi.fn>;
  };
}

const tickets = {} as TicketRepository;
const agentText = { generate: async () => 'generated' };

const upstreamOutputs = (number: number) => ({
  opened: { pullRequests: [{ repo: 'app', pr: { url: 'https://example/pr', number } }] },
});

describe('review scm action', () => {
  it('resolves the PR number from config and lists reviews', async () => {
    const scm = fakeScm();
    const { ctx } = makeCtx({ pr: 42 });

    const outcome = await review(ctx, { scm, tickets, agentText });

    expect(outcome.status).toBe('completed');
    expect(scm.listPullRequestReviews).toHaveBeenCalledWith('/origin/app', 42);
  });

  it('resolves the PR number from an upstream open_pull_request output', async () => {
    const scm = fakeScm();
    const { ctx } = makeCtx({}, upstreamOutputs(7));

    const outcome = await review(ctx, { scm, tickets, agentText });

    expect(outcome.status).toBe('completed');
    expect(scm.listPullRequestReviews).toHaveBeenCalledWith('/origin/app', 7);
  });

  it('requests reviewers when provided', async () => {
    const scm = fakeScm();
    const { ctx } = makeCtx({ pr: 5, reviewers: ['alice'], teamReviewers: ['core'] });

    const outcome = await review(ctx, { scm, tickets, agentText });

    expect(outcome.status).toBe('completed');
    expect(scm.requestReviewers).toHaveBeenCalledWith('/origin/app', {
      number: 5,
      reviewers: ['alice'],
      teamReviewers: ['core'],
    });
    if (outcome.status === 'completed') {
      expect(outcome.output).toMatchObject({ requested: ['alice', 'core'] });
    }
  });

  it('does not request reviewers when none are provided', async () => {
    const scm = fakeScm();
    const { ctx } = makeCtx({ pr: 5 });

    await review(ctx, { scm, tickets, agentText });

    expect(scm.requestReviewers).not.toHaveBeenCalled();
  });

  it('summarizes reviews with approved true when an APPROVED review is present', async () => {
    const reviews: PullRequestReview[] = [
      { user: 'bob', state: 'COMMENTED' },
      { user: 'alice', state: 'APPROVED' },
    ];
    const scm = fakeScm({ listPullRequestReviews: vi.fn().mockResolvedValue(reviews) });
    const { ctx } = makeCtx({ pr: 9 });

    const outcome = await review(ctx, { scm, tickets, agentText });

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.output).toEqual({
        number: 9,
        requested: [],
        reviews,
        approved: true,
        changesRequested: false,
      });
    }
  });

  it('fails when requireApproval is set and there is no approval', async () => {
    const reviews: PullRequestReview[] = [{ user: 'bob', state: 'COMMENTED' }];
    const scm = fakeScm({ listPullRequestReviews: vi.fn().mockResolvedValue(reviews) });
    const { ctx } = makeCtx({ pr: 9, requireApproval: true });

    const outcome = await review(ctx, { scm, tickets, agentText });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toMatch(/not approved/i);
    }
  });

  it('fails when requireApproval is set and changes are requested even if approved', async () => {
    const reviews: PullRequestReview[] = [
      { user: 'alice', state: 'APPROVED' },
      { user: 'bob', state: 'CHANGES_REQUESTED' },
    ];
    const scm = fakeScm({ listPullRequestReviews: vi.fn().mockResolvedValue(reviews) });
    const { ctx } = makeCtx({ pr: 9, requireApproval: true });

    const outcome = await review(ctx, { scm, tickets, agentText });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toMatch(/requested changes/i);
    }
  });

  it('completes when requireApproval is set and an APPROVED review is present', async () => {
    const reviews: PullRequestReview[] = [{ user: 'alice', state: 'APPROVED' }];
    const scm = fakeScm({ listPullRequestReviews: vi.fn().mockResolvedValue(reviews) });
    const { ctx } = makeCtx({ pr: 9, requireApproval: true });

    const outcome = await review(ctx, { scm, tickets, agentText });

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.output).toMatchObject({ approved: true, changesRequested: false });
    }
  });

  it('fails when no PR number can be resolved', async () => {
    const scm = fakeScm();
    const { ctx } = makeCtx({});

    const outcome = await review(ctx, { scm, tickets, agentText });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toMatch(/pull request number/i);
    }
    expect(scm.listPullRequestReviews).not.toHaveBeenCalled();
  });

  it('fails when the provider supports neither review method', async () => {
    const scm = {} as ScmProvider;
    const { ctx } = makeCtx({ pr: 1 });

    const outcome = await review(ctx, { scm, tickets, agentText });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toMatch(/does not support reviews/i);
    }
  });

  it('fails (never throws) when a provider method rejects', async () => {
    const scm = fakeScm({ listPullRequestReviews: vi.fn().mockRejectedValue(new Error('boom')) });
    const { ctx } = makeCtx({ pr: 3 });

    const outcome = await review(ctx, { scm, tickets, agentText });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toMatch(/review failed: boom/);
    }
  });
});
