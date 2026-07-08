import { describe, it, expect, vi } from 'vitest';
import { SlackNotifier } from './slack-notifier.js';

function okResponse(): Response {
  return { ok: true, status: 200, statusText: 'OK' } as Response;
}

describe('SlackNotifier', () => {
  it('defaults its registry key to slack', () => {
    const notifier = new SlackNotifier({
      url: 'https://hooks.slack.com/services/abc',
      fetchImpl: (async () => okResponse()) as unknown as typeof fetch,
    });
    expect(notifier.key).toBe('slack');
  });

  it('posts a Slack incoming-webhook payload with a text field', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    const notifier = new SlackNotifier({
      url: 'https://hooks.slack.com/services/abc',
      headers: { Authorization: 'Bearer t' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await notifier.notify({
      title: 'Run completed',
      body: 'Ticket #42 finished',
      level: 'info',
      url: 'https://github.com/pr/1',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/services/abc');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
    const payload = JSON.parse(init.body as string);
    expect(payload.text).toContain('Run completed');
    expect(payload.text).toContain('Ticket #42 finished');
    expect(payload.text).toContain('https://github.com/pr/1');
  });

  it('throws when Slack returns a non-2xx response', async () => {
    const fetchImpl = vi.fn(
      async () => ({ ok: false, status: 500, statusText: 'Server Error' }) as Response,
    );
    const notifier = new SlackNotifier({
      url: 'https://hooks.slack.com/services/abc',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(notifier.notify({ title: 'x', body: 'y' })).rejects.toThrow('500');
  });

  it('requires a url', () => {
    expect(() => new SlackNotifier({ url: '' })).toThrow('requires a url');
  });
});
