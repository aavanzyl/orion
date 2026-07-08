import { describe, expect, it, vi } from 'vitest';
import type { WorkflowNodeConfig } from '@orion/models';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import { HttpNodeExecutor } from './http.executor.js';

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
  signal?: AbortSignal,
): { ctx: NodeExecutionContext; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    nodeConfig: { id: 'h1', type: 'http', ...nodeConfig } as WorkflowNodeConfig,
    nodeOutputs,
    emit,
    signal,
  } as unknown as NodeExecutionContext;
  return { ctx, emit };
}

describe('HttpNodeExecutor', () => {
  it('fails when the node has no url', async () => {
    const fetchImpl = vi.fn();
    const { ctx } = makeCtx({ url: undefined });

    const outcome = await new HttpNodeExecutor({ fetchImpl }).execute(ctx);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error).toMatch(/no url/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('performs a GET with no body and parses the JSON response into output', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '{"ok":true}' }));
    const { ctx } = makeCtx({ url: 'https://api.test/data' });

    const outcome = await new HttpNodeExecutor({ fetchImpl }).execute(ctx);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.test/data');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.output).toEqual({ status: 200, body: { ok: true } });
    }
  });

  it('renders {{ nodes.x.y }} templates in url, headers and body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));
    const { ctx } = makeCtx(
      {
        url: 'https://api.test/{{ nodes.prev.id }}',
        method: 'POST',
        headers: { 'X-Trace': '{{ nodes.prev.trace }}' },
        body: '{"name":"{{ nodes.prev.name }}"}',
      },
      { prev: { id: '42', trace: 'abc', name: 'orion' } },
    );

    await new HttpNodeExecutor({ fetchImpl }).execute(ctx);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.test/42');
    expect(init.headers['X-Trace']).toBe('abc');
    expect(init.body).toBe('{"name":"orion"}');
  });

  it('POST sets Content-Type application/json when absent and sends the body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ status: 201, body: '{}' }));
    const { ctx } = makeCtx({ url: 'https://api.test', method: 'POST', body: '{"a":1}' });

    const outcome = await new HttpNodeExecutor({ fetchImpl }).execute(ctx);

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
    expect(outcome.status).toBe('completed');
  });

  it('does not override an existing content-type header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));
    const { ctx } = makeCtx({
      url: 'https://api.test',
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: 'raw',
    });

    await new HttpNodeExecutor({ fetchImpl }).execute(ctx);

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers['content-type']).toBe('text/plain');
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBe('raw');
  });

  it('does not send a body on GET even when body is configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));
    const { ctx } = makeCtx({ url: 'https://api.test', method: 'GET', body: '{"a":1}' });

    await new HttpNodeExecutor({ fetchImpl }).execute(ctx);

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.body).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('decrypts the token and never logs, emits or returns it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '{"ok":true}' }));
    const decryptToken = vi.fn().mockReturnValue('secret-plain-token');
    const { ctx, emit } = makeCtx({ url: 'https://api.test', token: 'aes256:ciphertext' });

    const outcome = await new HttpNodeExecutor({
      fetchImpl,
      decryptToken,
      encryptionSalt: 'salt',
    }).execute(ctx);

    expect(decryptToken).toHaveBeenCalledWith('aes256:ciphertext', 'salt');
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer secret-plain-token');

    const emitted = JSON.stringify(emit.mock.calls);
    expect(emitted).not.toContain('secret-plain-token');
    expect(emitted).not.toContain('aes256:ciphertext');
    expect(emitted).not.toContain('Authorization');

    const outputStr = JSON.stringify(outcome);
    expect(outputStr).not.toContain('secret-plain-token');
    expect(outputStr).not.toContain('aes256:ciphertext');
  });

  it('emits a log containing only method, url and status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));
    const { ctx, emit } = makeCtx({ url: 'https://api.test/x', method: 'POST', body: '{}' });

    await new HttpNodeExecutor({ fetchImpl }).execute(ctx);

    expect(emit).toHaveBeenCalledTimes(1);
    const [type, payload] = emit.mock.calls[0];
    expect(type).toBe('log');
    expect(payload).toEqual({ message: 'HTTP POST https://api.test/x -> 200', status: 200 });
  });

  it('uses the token as-is when no salt is set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));
    const decryptToken = vi.fn();
    const { ctx } = makeCtx({ url: 'https://api.test', token: 'plain-token' });

    await new HttpNodeExecutor({ fetchImpl, decryptToken }).execute(ctx);

    expect(decryptToken).not.toHaveBeenCalled();
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer plain-token');
  });

  it('fails on a non-2xx response and does not complete', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeResponse({ status: 500, statusText: 'Server Error', body: 'boom' }));
    const { ctx } = makeCtx({ url: 'https://api.test' });

    const outcome = await new HttpNodeExecutor({ fetchImpl }).execute(ctx);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toMatch(/HTTP 500 Server Error/);
      expect(outcome.error).toContain('boom');
    }
  });

  it('truncates a long response snippet in the failure error', async () => {
    const long = 'x'.repeat(2000);
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ status: 400, body: long }));
    const { ctx } = makeCtx({ url: 'https://api.test' });

    const outcome = await new HttpNodeExecutor({ fetchImpl }).execute(ctx);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error.length).toBeLessThanOrEqual(600);
      expect(outcome.error).not.toContain('x'.repeat(600));
    }
  });

  it('fails when fetch throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const { ctx } = makeCtx({ url: 'https://api.test' });

    const outcome = await new HttpNodeExecutor({ fetchImpl }).execute(ctx);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error).toMatch(/http request failed: network down/);
  });

  it('passes ctx.signal through to fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));
    const controller = new AbortController();
    const { ctx } = makeCtx({ url: 'https://api.test' }, {}, controller.signal);

    await new HttpNodeExecutor({ fetchImpl }).execute(ctx);

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.signal).toBe(controller.signal);
  });
});
