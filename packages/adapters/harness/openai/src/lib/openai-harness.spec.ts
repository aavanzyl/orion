import { describe, expect, it } from 'vitest';
import { OpenAiHarness } from './openai-harness.js';

/** Build a mock streaming Response from a list of SSE `data:` payloads. */
function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const body = chunks.map((c) => `data: ${c}\n\n`).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

describe('OpenAiHarness', () => {
  it('streams incremental message events and a final completed result', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (url: string, opts: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body as string);
      return sseResponse([
        JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
        JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }),
        '[DONE]',
      ]);
    }) as typeof fetch;

    try {
      const harness = new OpenAiHarness({ baseUrl: 'https://api.deepseek.com/v1' });
      const events = [];
      for await (const event of harness.runStreamed('hi', {
        workingDirectory: '/tmp',
        apiKey: 'sk-test',
        model: 'deepseek-v4-pro',
      })) {
        events.push(event);
      }

      expect(capturedUrl).toBe('https://api.deepseek.com/v1/chat/completions');
      expect(capturedBody.model).toBe('deepseek-v4-pro');
      expect(capturedBody.stream).toBe(true);

      const messages = events.filter((e) => e.type === 'message');
      expect(messages.at(-1)).toEqual({ type: 'message', text: 'Hello' });

      const completed = events.at(-1);
      expect(completed).toMatchObject({
        type: 'completed',
        result: { finalResponse: 'Hello', usage: { totalTokens: 5 } },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('emits reasoning content as accumulating item events', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      sseResponse([
        JSON.stringify({ choices: [{ delta: { reasoning_content: 'Let me ' } }] }),
        JSON.stringify({ choices: [{ delta: { reasoning_content: 'think.' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'Answer' } }] }),
        '[DONE]',
      ])) as typeof fetch;

    try {
      const harness = new OpenAiHarness({ baseUrl: 'https://api.deepseek.com/v1' });
      const events = [];
      for await (const event of harness.runStreamed('hi', {
        workingDirectory: '/tmp',
        apiKey: 'sk-test',
      })) {
        events.push(event);
      }

      const items = events.filter((e) => e.type === 'item');
      expect(items.at(-1)).toEqual({
        type: 'item',
        item: { id: 'reasoning', type: 'reasoning', text: 'Let me think.' },
      });
      const messages = events.filter((e) => e.type === 'message');
      expect(messages.at(-1)).toEqual({ type: 'message', text: 'Answer' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws a descriptive error on a failed request', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('nope', { status: 404, statusText: 'Not Found' })) as typeof fetch;
    try {
      const harness = new OpenAiHarness();
      const iterate = async () => {
        for await (const _ of harness.runStreamed('hi', {
          workingDirectory: '/tmp',
          apiKey: 'sk-test',
        })) {
          // drain
        }
      };
      await expect(iterate()).rejects.toThrow(/404 Not Found/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('requires an API key', async () => {
    const harness = new OpenAiHarness();
    const iterate = async () => {
      for await (const _ of harness.runStreamed('hi', { workingDirectory: '/tmp' })) {
        // drain
      }
    };
    await expect(iterate()).rejects.toThrow(/requires an API key/);
  });
});
