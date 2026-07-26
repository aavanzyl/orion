import { describe, it, expect, vi } from 'vitest';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import type { ScmProvider } from '@orion/scm-core';
import type { TicketRepository } from '@orion/db';
import type { ScmActionDeps } from './types.js';
import { push } from './push.js';

interface FakeRepo {
  name: string;
  path: string;
  originPath: string;
  branch: string;
  baseBranch: string;
}

function makeRepo(name: string): FakeRepo {
  return {
    name,
    path: `/ws/${name}`,
    originPath: `git@github.com:acme/${name}.git`,
    branch: 'orion/run-1',
    baseBranch: 'main',
  };
}

function makeCtx(
  config: Record<string, unknown>,
  repos: FakeRepo[] = [makeRepo('app')],
  nodeOutputs: Record<string, unknown> = {},
): { ctx: NodeExecutionContext; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn(async () => undefined);
  const ctx = {
    nodeConfig: { type: 'scm', action: 'push', config },
    workspace: { repos },
    nodeOutputs,
    emit,
  } as unknown as NodeExecutionContext;
  return { ctx, emit };
}

function makeDeps(overrides: Partial<ScmProvider> = {}): {
  deps: ScmActionDeps;
  pushFn: ReturnType<typeof vi.fn>;
} {
  const pushFn = vi.fn(async () => undefined);
  const scm = { push: pushFn, ...overrides } as unknown as ScmProvider;
  const tickets = {} as TicketRepository;
  const agentText = { generate: async () => 'generated' };
  return { deps: { scm, tickets, agentText }, pushFn };
}

describe('push', () => {
  it('pushes the default branch and completes', async () => {
    const { ctx, emit } = makeCtx({});
    const { deps, pushFn } = makeDeps();

    const outcome = await push(ctx, deps);

    expect(outcome).toMatchObject({
      status: 'completed',
      output: { repos: ['app'] },
    });
    expect(pushFn).toHaveBeenCalledWith('/ws/app', 'orion/run-1');
    expect(emit).toHaveBeenCalled();
  });

  it('pushes a config-specified branch', async () => {
    const { ctx } = makeCtx({ branch: 'feature/my-branch' });
    const { deps, pushFn } = makeDeps();

    const outcome = await push(ctx, deps);

    expect(outcome!).toMatchObject({ status: 'completed', output: { repos: ['app'] } });
    expect(pushFn).toHaveBeenCalledWith('/ws/app', 'feature/my-branch');
  });

  it('resolves a templated branch from nodeOutputs', async () => {
    const { ctx } = makeCtx(
      { branch: '{{ nodes.release.branch }}' },
      [makeRepo('app')],
      { release: { branch: 'release/v1' } },
    );
    const { deps, pushFn } = makeDeps();

    const outcome = await push(ctx, deps);

    expect(outcome!).toMatchObject({ status: 'completed', output: { repos: ['app'] } });
    expect(pushFn).toHaveBeenCalledWith('/ws/app', 'release/v1');
  });

  it('pushes every repo in the workspace', async () => {
    const { ctx } = makeCtx({}, [makeRepo('app'), makeRepo('api')]);
    const { deps, pushFn } = makeDeps();

    const outcome = await push(ctx, deps);

    expect(outcome).toMatchObject({ status: 'completed', output: { repos: ['app', 'api'] } });
    expect(pushFn).toHaveBeenCalledTimes(2);
    expect(pushFn).toHaveBeenNthCalledWith(1, '/ws/app', 'orion/run-1');
    expect(pushFn).toHaveBeenNthCalledWith(2, '/ws/api', 'orion/run-1');
  });

  it('fails without throwing when push rejects', async () => {
    const { ctx } = makeCtx({});
    const pushFn = vi.fn(async () => {
      throw new Error('git push boom');
    });
    const scm = { push: pushFn } as unknown as ScmProvider;

    const outcome = await push(ctx, {
      scm,
      tickets: {} as TicketRepository,
      agentText: { generate: async () => 'generated' },
    });

    expect(outcome.status).toBe('failed');
    expect((outcome as { error: string }).error).toContain('git push boom');
  });
});
