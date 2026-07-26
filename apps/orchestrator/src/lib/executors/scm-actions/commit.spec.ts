import { describe, it, expect, vi } from 'vitest';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import type { ScmProvider } from '@orion/scm-core';
import type { TicketRepository } from '@orion/db';
import type { ScmActionDeps } from './types.js';
import { commit } from './commit.js';

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
    nodeConfig: { type: 'scm', action: 'commit', config },
    workspace: { repos },
    nodeOutputs,
    emit,
  } as unknown as NodeExecutionContext;
  return { ctx, emit };
}

function makeDeps(overrides: Partial<ScmProvider> = {}): {
  deps: ScmActionDeps;
  hasChanges: ReturnType<typeof vi.fn>;
  commitAll: ReturnType<typeof vi.fn>;
} {
  const hasChanges = vi.fn(async () => true);
  const commitAll = vi.fn(async () => undefined);
  const scm = { hasChanges, commitAll, ...overrides } as unknown as ScmProvider;
  const tickets = {} as TicketRepository;
  const agentText = { generate: async () => 'generated' };
  return { deps: { scm, tickets, agentText }, hasChanges, commitAll };
}

describe('commit', () => {
  it('fails when message is missing', async () => {
    const { ctx } = makeCtx({});
    const { deps, commitAll } = makeDeps();

    const outcome = await commit(ctx, deps);

    expect(outcome.status).toBe('failed');
    expect(commitAll).not.toHaveBeenCalled();
  });

  it('fails when message is empty', async () => {
    const { ctx } = makeCtx({ message: '' });
    const { deps, commitAll } = makeDeps();

    const outcome = await commit(ctx, deps);

    expect(outcome.status).toBe('failed');
    expect(commitAll).not.toHaveBeenCalled();
  });

  it('commits changes and completes', async () => {
    const { ctx, emit } = makeCtx({ message: 'fix: typo' });
    const { deps, hasChanges, commitAll } = makeDeps();

    const outcome = await commit(ctx, deps);

    expect(outcome).toMatchObject({
      status: 'completed',
      output: { message: 'fix: typo', repos: ['app'] },
    });
    expect(hasChanges).toHaveBeenCalledWith('/ws/app');
    expect(commitAll).toHaveBeenCalledWith('/ws/app', 'fix: typo');
    expect(emit).toHaveBeenCalled();
  });

  it('skips repos with no changes', async () => {
    const { ctx } = makeCtx({ message: 'fix: typo' }, [makeRepo('app'), makeRepo('api')]);
    const hasChanges = vi.fn(async (path: string) => path === '/ws/app');
    const commitAll = vi.fn(async () => undefined);
    const scm = { hasChanges, commitAll } as unknown as ScmProvider;
    const tickets = {} as TicketRepository;
    const agentText = { generate: async () => 'generated' };

    const outcome = await commit(ctx, { scm, tickets, agentText });

    expect(outcome).toMatchObject({
      status: 'completed',
      output: { message: 'fix: typo', repos: ['app'] },
    });
    expect(commitAll).toHaveBeenCalledTimes(1);
    expect(commitAll).toHaveBeenCalledWith('/ws/app', 'fix: typo');
  });

  it('reports no changes when nothing is dirty', async () => {
    const { ctx } = makeCtx({ message: 'fix: typo' });
    const hasChanges = vi.fn(async () => false);
    const commitAll = vi.fn(async () => undefined);
    const scm = { hasChanges, commitAll } as unknown as ScmProvider;
    const tickets = {} as TicketRepository;
    const agentText = { generate: async () => 'generated' };

    const outcome = await commit(ctx, { scm, tickets, agentText });

    expect(outcome).toMatchObject({
      status: 'completed',
      output: { message: 'No changes to commit' },
    });
    expect(commitAll).not.toHaveBeenCalled();
  });

  it('resolves a templated message from nodeOutputs', async () => {
    const { ctx } = makeCtx(
      { message: 'release {{ nodes.version.version }}' },
      [makeRepo('app')],
      { version: { version: 'v2.3.4' } },
    );
    const { deps, commitAll } = makeDeps();

    const outcome = await commit(ctx, deps);

    expect(outcome).toMatchObject({
      status: 'completed',
      output: { message: 'release v2.3.4' },
    });
    expect(commitAll).toHaveBeenCalledWith('/ws/app', 'release v2.3.4');
  });

  it('commits every repo in the workspace', async () => {
    const { ctx } = makeCtx({ message: 'fix: all the things' }, [makeRepo('app'), makeRepo('api')]);
    const { deps, commitAll } = makeDeps();

    const outcome = await commit(ctx, deps);

    expect(outcome).toMatchObject({ status: 'completed', output: { repos: ['app', 'api'] } });
    expect(commitAll).toHaveBeenCalledTimes(2);
  });

  it('fails without throwing when commitAll rejects', async () => {
    const { ctx } = makeCtx({ message: 'fix: typo' });
    const hasChanges = vi.fn(async () => true);
    const commitAll = vi.fn(async () => {
      throw new Error('git commit boom');
    });
    const scm = { hasChanges, commitAll } as unknown as ScmProvider;
    const tickets = {} as TicketRepository;
    const agentText = { generate: async () => 'generated' };

    const outcome = await commit(ctx, { scm, tickets, agentText });

    expect(outcome.status).toBe('failed');
    expect((outcome as { error: string }).error).toContain('git commit boom');
  });
});
