import { describe, it, expect, vi } from 'vitest';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import type { ScmProvider, Release } from '@orion/scm-core';
import type { TicketRepository } from '@orion/db';
import type { ScmActionDeps } from './types.js';
import { tagRelease } from './tag-release.js';

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
    nodeConfig: { type: 'scm', action: 'tag_release', config },
    workspace: { repos },
    nodeOutputs,
    emit,
  } as unknown as NodeExecutionContext;
  return { ctx, emit };
}

function makeDeps(overrides: Partial<ScmProvider> = {}): {
  deps: ScmActionDeps;
  createTag: ReturnType<typeof vi.fn>;
  createRelease: ReturnType<typeof vi.fn>;
} {
  const release: Release = { url: 'https://github.com/acme/app/releases/1', id: 1, tag: 'v1.0.0' };
  const createTag = vi.fn(async () => undefined);
  const createRelease = vi.fn(async () => release);
  const scm = { createTag, createRelease, ...overrides } as unknown as ScmProvider;
  const tickets = {} as TicketRepository;
  const agentText = { generate: async () => 'generated' };
  return { deps: { scm, tickets, agentText }, createTag, createRelease };
}

describe('tagRelease', () => {
  it('fails when tag is missing', async () => {
    const { ctx } = makeCtx({});
    const { deps, createTag } = makeDeps();

    const outcome = await tagRelease(ctx, deps);

    expect(outcome.status).toBe('failed');
    expect(createTag).not.toHaveBeenCalled();
  });

  it('fails when the provider does not support tagging', async () => {
    const { ctx } = makeCtx({ tag: 'v1.0.0' });
    const scm = {} as unknown as ScmProvider;
    const outcome = await tagRelease(ctx, { scm, tickets: {} as TicketRepository, agentText: { generate: async () => 'generated' } });

    expect(outcome.status).toBe('failed');
    expect(outcome).toMatchObject({ error: 'scm provider does not support tagging' });
  });

  it('creates a tag without a release and completes', async () => {
    const { ctx, emit } = makeCtx({ tag: 'v1.0.0', message: 'first cut', ref: 'abc123' });
    const { deps, createTag, createRelease } = makeDeps();

    const outcome = await tagRelease(ctx, deps);

    expect(outcome).toMatchObject({ status: 'completed', output: { tag: 'v1.0.0', repos: ['app'] } });
    expect(createTag).toHaveBeenCalledWith('/ws/app', {
      tag: 'v1.0.0',
      message: 'first cut',
      ref: 'abc123',
    });
    expect(createRelease).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalled();
  });

  it('publishes a release when release:true', async () => {
    const { ctx } = makeCtx({ tag: 'v1.0.0', name: 'Release 1', body: 'notes', release: true });
    const { deps, createRelease } = makeDeps();

    const outcome = await tagRelease(ctx, deps);

    expect(outcome.status).toBe('completed');
    expect(createRelease).toHaveBeenCalledWith('git@github.com:acme/app.git', {
      tag: 'v1.0.0',
      name: 'Release 1',
      body: 'notes',
      target: undefined,
      draft: undefined,
      prerelease: undefined,
    });
    const output = (outcome as { output: { releases: Array<{ repo: string; release: Release }> } }).output;
    expect(output.releases[0]).toMatchObject({ repo: 'app', release: { tag: 'v1.0.0' } });
  });

  it('resolves a templated tag from nodeOutputs', async () => {
    const { ctx } = makeCtx(
      { tag: '{{ nodes.version.version }}' },
      [makeRepo('app')],
      { version: { version: 'v2.3.4' } },
    );
    const { deps, createTag } = makeDeps();

    const outcome = await tagRelease(ctx, deps);

    expect(outcome).toMatchObject({ status: 'completed', output: { tag: 'v2.3.4' } });
    expect(createTag).toHaveBeenCalledWith('/ws/app', {
      tag: 'v2.3.4',
      message: undefined,
      ref: undefined,
    });
  });

  it('tags every repo in the workspace by default', async () => {
    const { ctx } = makeCtx({ tag: 'v1.0.0' }, [makeRepo('app'), makeRepo('api')]);
    const { deps, createTag } = makeDeps();

    const outcome = await tagRelease(ctx, deps);

    expect(outcome).toMatchObject({ status: 'completed', output: { repos: ['app', 'api'] } });
    expect(createTag).toHaveBeenCalledTimes(2);
    expect(createTag).toHaveBeenNthCalledWith(1, '/ws/app', expect.any(Object));
    expect(createTag).toHaveBeenNthCalledWith(2, '/ws/api', expect.any(Object));
  });

  it('targets a single repo via config.repo', async () => {
    const { ctx } = makeCtx({ tag: 'v1.0.0', repo: 'api' }, [makeRepo('app'), makeRepo('api')]);
    const { deps, createTag } = makeDeps();

    const outcome = await tagRelease(ctx, deps);

    expect(outcome).toMatchObject({ status: 'completed', output: { repos: ['api'] } });
    expect(createTag).toHaveBeenCalledTimes(1);
    expect(createTag).toHaveBeenCalledWith('/ws/api', expect.any(Object));
  });

  it('fails without throwing when createTag rejects', async () => {
    const { ctx } = makeCtx({ tag: 'v1.0.0' });
    const createTag = vi.fn(async () => {
      throw new Error('git boom');
    });
    const scm = { createTag } as unknown as ScmProvider;

    const outcome = await tagRelease(ctx, { scm, tickets: {} as TicketRepository, agentText: { generate: async () => 'generated' } });

    expect(outcome.status).toBe('failed');
    expect((outcome as { error: string }).error).toContain('git boom');
  });
});
