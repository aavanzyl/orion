import { describe, it, expect, vi } from 'vitest';
import { WebhookNotifier } from './webhook-notifier.js';

function okResponse(): Response {
  return { ok: true, status: 200, statusText: 'OK' } as Response;
}

describe('WebhookNotifier', () => {
  it('posts a JSON payload compatible with Slack and Discord', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    const notifier = new WebhookNotifier({
      url: 'https://hooks.example.com/abc',
      headers: { Authorization: 'Bearer t' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await notifier.notify({
      title: 'Run completed',
      body: 'Ticket #42 finished',
      level: 'info',
      url: 'https://github.com/pr/1',
    });

    expect(notifier.key).toBe('webhook');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://hooks.example.com/abc');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
    const payload = JSON.parse(init.body as string);
    expect(payload.text).toContain('Run completed');
    expect(payload.text).toContain('Ticket #42 finished');
    expect(payload.content).toBe(payload.text);
    expect(payload.title).toBe('Run completed');
    expect(payload.level).toBe('info');
    expect(payload.url).toBe('https://github.com/pr/1');
  });

  it('throws when the webhook returns a non-2xx response', async () => {
    const fetchImpl = vi.fn(
      async () => ({ ok: false, status: 500, statusText: 'Server Error' }) as Response,
    );
    const notifier = new WebhookNotifier({
      url: 'https://hooks.example.com/abc',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(notifier.notify({ title: 'x', body: 'y' })).rejects.toThrow('500');
  });

  it('requires a url', () => {
    expect(() => new WebhookNotifier({ url: '' })).toThrow('requires a url');
  });
});
