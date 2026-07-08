import { describe, it, expect, vi } from 'vitest';
import type { MergePullRequestInput, MergeResult, ScmProvider } from '@orion/scm-core';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import type { TicketRepository } from '@orion/db';
import { merge } from './merge.js';

function makeScm(
  impl?: (repoPath: string, input: MergePullRequestInput) => Promise<MergeResult> | MergeResult,
): { scm: ScmProvider; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(impl ?? (async () => ({ merged: true, sha: 'deadbeef' })));
  const scm = { mergePullRequest: spy } as unknown as ScmProvider;
  return { scm, spy };
}

function makeCtx(
  config: Record<string, unknown> | undefined,
  nodeOutputs: Record<string, unknown> = {},
): { ctx: NodeExecutionContext; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn(async () => undefined);
  const ctx = {
    nodeConfig: { type: 'scm', action: 'merge', config },
    nodeOutputs,
    emit,
    workspace: {
      repos: [{ name: 'r', path: '/wt/r', originPath: '/origin/r', branch: 'feat', baseBranch: 'main' }],
    },
  } as unknown as NodeExecutionContext;
  return { ctx, emit };
}

const tickets = {} as TicketRepository;

describe('merge scm action', () => {
  it('merges the explicit config.pr number', async () => {
    const { scm, spy } = makeScm();
    const { ctx, emit } = makeCtx({ pr: 7 });

    const outcome = await merge(ctx, { scm, tickets });

    expect(outcome).toMatchObject({ status: 'completed', output: { merged: true, sha: 'deadbeef', number: 7 } });
    expect(spy).toHaveBeenCalledWith('/origin/r', {
      number: 7,
      method: 'merge',
      commitTitle: undefined,
      commitMessage: undefined,
    });
    expect(emit).toHaveBeenCalled();
  });

  it('resolves the PR number from an upstream open_pull_request node output', async () => {
    const { scm, spy } = makeScm();
    const { ctx } = makeCtx(undefined, {
      openPr: { pullRequests: [{ repo: 'r', pr: { url: 'https://gh/pr/42', number: 42 } }] },
    });

    const outcome = await merge(ctx, { scm, tickets });

    expect(outcome).toMatchObject({ status: 'completed', output: { number: 42 } });
    expect(spy).toHaveBeenCalledWith('/origin/r', expect.objectContaining({ number: 42 }));
  });

  it('fails when no PR number can be resolved', async () => {
    const { scm, spy } = makeScm();
    const { ctx } = makeCtx(undefined, {});

    const outcome = await merge(ctx, { scm, tickets });

    expect(outcome.status).toBe('failed');
    expect(spy).not.toHaveBeenCalled();
  });

  it('fails when the provider reports merged:false, carrying its message', async () => {
    const { scm } = makeScm(async () => ({ merged: false, message: 'not mergeable' }));
    const { ctx } = makeCtx({ pr: 1 });

    const outcome = await merge(ctx, { scm, tickets });

    expect(outcome).toEqual({ status: 'failed', error: 'not mergeable' });
  });

  it('fails when the provider does not support merging', async () => {
    const scm = {} as unknown as ScmProvider;
    const { ctx } = makeCtx({ pr: 1 });

    const outcome = await merge(ctx, { scm, tickets });

    expect(outcome).toEqual({ status: 'failed', error: 'scm provider does not support merging' });
  });

  it('defaults to method "merge" and passes config.method:"squash" through', async () => {
    const { scm, spy } = makeScm();
    const { ctx } = makeCtx({ pr: 9, method: 'squash', commitTitle: 'T', commitMessage: 'M' });

    const outcome = await merge(ctx, { scm, tickets });

    expect(outcome.status).toBe('completed');
    expect(spy).toHaveBeenCalledWith('/origin/r', {
      number: 9,
      method: 'squash',
      commitTitle: 'T',
      commitMessage: 'M',
    });
  });
});
