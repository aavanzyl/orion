import { describe, expect, it, vi } from 'vitest';
import type { WorkflowNodeConfig } from '@orion/models';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import { GraphqlNodeExecutor } from './graphql.executor.js';

interface FakeResponseInit {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: string;
}

function fakeResponse(init: FakeResponseInit = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    statusText: init.statusText ?? '',
    text: async () => init.body ?? '',
  } as unknown as Response;
}

function makeCtx(
  nodeConfig: Partial<WorkflowNodeConfig>,
  nodeOutputs: Record<string, unknown> = {},
): { ctx: NodeExecutionContext; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    nodeConfig: { id: 'g1', type: 'graphql', ...nodeConfig } as WorkflowNodeConfig,
    nodeOutputs,
    emit,
  } as unknown as NodeExecutionContext;
  return { ctx, emit };
}

describe('GraphqlNodeExecutor', () => {
  it('fails when the node has no url', async () => {
    const fetchImpl = vi.fn();
    const { ctx } = makeCtx({ query: '{ me { id } }' });

    const outcome = await new GraphqlNodeExecutor({ fetchImpl }).execute(ctx);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error).toMatch(/no url/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails when the node has no query', async () => {
    const fetchImpl = vi.fn();
    const { ctx } = makeCtx({ url: 'https://api/graphql' });

    const outcome = await new GraphqlNodeExecutor({ fetchImpl }).execute(ctx);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error).toMatch(/no query/i);
  });

  it('POSTs the query and returns response.data', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeResponse({ status: 200, body: '{"data":{"me":{"id":"1"}}}' }));
    const { ctx } = makeCtx({ url: 'https://api/graphql', query: '{ me { id } }' });

    const outcome = await new GraphqlNodeExecutor({ fetchImpl }).execute(ctx);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api/graphql');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ query: '{ me { id } }' });
    expect(outcome).toMatchObject({ status: 'completed', output: { data: { me: { id: '1' } } } });
  });

  it('sends parsed variables when provided', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '{"data":{}}' }));
    const { ctx } = makeCtx({
      url: 'https://api/graphql',
      query: 'query($id: ID!) { node(id: $id) { id } }',
      variables: '{"id": "{{ nodes.plan.data.id }}"}',
    }, { plan: { data: { id: 'abc' } } });

    await new GraphqlNodeExecutor({ fetchImpl }).execute(ctx);

    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body).variables).toEqual({ id: 'abc' });
  });

  it('fails when the response contains graphql errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeResponse({ status: 200, body: '{"errors":[{"message":"nope"}]}' }));
    const { ctx } = makeCtx({ url: 'https://api/graphql', query: '{ me { id } }' });

    const outcome = await new GraphqlNodeExecutor({ fetchImpl }).execute(ctx);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error).toMatch(/graphql errors/);
  });

  it('fails on a non-2xx response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeResponse({ status: 500, statusText: 'Server Error', body: 'boom' }));
    const { ctx } = makeCtx({ url: 'https://api/graphql', query: '{ me { id } }' });

    const outcome = await new GraphqlNodeExecutor({ fetchImpl }).execute(ctx);

    expect(outcome.status).toBe('failed');
  });

  it('fails when variables are not valid JSON', async () => {
    const fetchImpl = vi.fn();
    const { ctx } = makeCtx({
      url: 'https://api/graphql',
      query: '{ me { id } }',
      variables: 'not json',
    });

    const outcome = await new GraphqlNodeExecutor({ fetchImpl }).execute(ctx);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error).toMatch(/not valid JSON/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
