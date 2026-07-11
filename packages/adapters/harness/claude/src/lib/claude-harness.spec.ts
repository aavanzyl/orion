import { beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedQuery {
  prompt: unknown;
  options: Record<string, unknown>;
}

let queued: unknown[] = [];
let captured: CapturedQuery | undefined;

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: CapturedQuery) => {
    captured = { prompt, options };
    return (async function* () {
      for (const message of queued) yield message;
    })();
  },
}));

import { ClaudeHarness } from './claude-harness.js';

describe('ClaudeHarness', () => {
  beforeEach(() => {
    queued = [];
    captured = undefined;
  });

  it('streams assistant text and a final completed result', async () => {
    queued = [
      {
        type: 'assistant',
        session_id: 'sess-1',
        message: { content: [{ type: 'text', text: 'Hello' }] },
      },
      {
        type: 'result',
        subtype: 'success',
        session_id: 'sess-1',
        result: 'Hello world',
        is_error: false,
        total_cost_usd: 0.01,
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    ];

    const harness = new ClaudeHarness({ baseUrl: 'https://api.deepseek.com/anthropic' });
    const events = [];
    for await (const event of harness.runStreamed('hi', {
      workingDirectory: '/tmp/work',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      threadId: 'sess-1',
    })) {
      events.push(event);
    }

    expect(captured?.options.cwd).toBe('/tmp/work');
    expect(captured?.options.model).toBe('deepseek-chat');
    expect(captured?.options.permissionMode).toBe('bypassPermissions');
    expect(captured?.options.resume).toBe('sess-1');
    const env = captured?.options.env as Record<string, string>;
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic');
    expect(env.ANTHROPIC_MODEL).toBe('deepseek-chat');
    expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBe('deepseek-chat');

    const messages = events.filter((e) => e.type === 'message');
    expect(messages.at(-1)).toEqual({ type: 'message', text: 'Hello world' });

    const completed = events.at(-1);
    expect(completed).toMatchObject({
      type: 'completed',
      result: {
        finalResponse: 'Hello world',
        threadId: 'sess-1',
        usage: { totalTokens: 5, costUsd: 0.01 },
      },
    });
  });

  it('uses the x-api-key env and no bearer token for the official Anthropic API', async () => {
    queued = [
      {
        type: 'result',
        subtype: 'success',
        session_id: 's',
        result: 'hi',
        is_error: false,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ];

    const harness = new ClaudeHarness();
    for await (const _event of harness.runStreamed('hi', {
      workingDirectory: '/tmp',
      apiKey: 'sk-anthropic',
    })) {
      void _event;
    }

    const env = captured?.options.env as Record<string, string>;
    expect(env.ANTHROPIC_API_KEY).toBe('sk-anthropic');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('strips a trailing /v1 from the base URL', async () => {
    queued = [
      {
        type: 'result',
        subtype: 'success',
        session_id: 's',
        result: 'hi',
        is_error: false,
        usage: {},
      },
    ];

    const harness = new ClaudeHarness();
    for await (const _event of harness.runStreamed('hi', {
      workingDirectory: '/tmp',
      apiKey: 'sk-test',
      baseUrl: 'https://api.anthropic.com/v1/',
    })) {
      void _event;
    }

    const env = captured?.options.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
  });

  it('emits non-text content blocks as item events', async () => {
    queued = [
      {
        type: 'assistant',
        session_id: 'sess-2',
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        session_id: 'sess-2',
        result: 'done',
        is_error: false,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ];

    const harness = new ClaudeHarness();
    const events = [];
    for await (const event of harness.runStreamed('hi', { workingDirectory: '/tmp' })) {
      events.push(event);
    }

    const items = events.filter((e) => e.type === 'item');
    expect(items.at(-1)).toEqual({
      type: 'item',
      item: { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
    });
  });

  it('throws a descriptive error on a failed result', async () => {
    queued = [
      {
        type: 'result',
        subtype: 'error_during_execution',
        session_id: 'sess-3',
        is_error: true,
        errors: ['boom'],
        usage: {},
      },
    ];

    const harness = new ClaudeHarness();
    const iterate = async () => {
      for await (const event of harness.runStreamed('hi', { workingDirectory: '/tmp' })) {
        void event;
      }
    };
    await expect(iterate()).rejects.toThrow(/Claude agent failed: boom/);
  });
});
