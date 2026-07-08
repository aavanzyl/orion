import type { Notification, Notifier } from '@orion/communication-core';

export interface WebhookNotifierOptions {
  /** Destination URL that receives a JSON POST for every notification. */
  url: string;
  /** Registry key; defaults to `webhook`. */
  key?: string;
  /** Extra headers (e.g. an auth token) sent with every request. */
  headers?: Record<string, string>;
  /** Injectable fetch implementation (defaults to the global `fetch`). */
  fetchImpl?: typeof fetch;
}

const LEVEL_EMOJI: Record<NonNullable<Notification['level']>, string> = {
  info: 'ℹ️',
  warn: '⚠️',
  error: '🚨',
};

/**
 * Generic outbound webhook notifier. Posts a JSON payload for each notification
 * that is compatible with Slack (`text`) and Discord (`content`) incoming
 * webhooks while also carrying the structured fields for custom consumers.
 */
export class WebhookNotifier implements Notifier {
  readonly key: string;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WebhookNotifierOptions) {
    if (!options.url) throw new Error('WebhookNotifier requires a url');
    this.key = options.key ?? 'webhook';
    this.url = options.url;
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('WebhookNotifier requires a fetch implementation');
    }
  }

  async notify(notification: Notification): Promise<void> {
    const text = this.format(notification);
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify({
        text,
        content: text,
        title: notification.title,
        body: notification.body,
        level: notification.level ?? 'info',
        url: notification.url,
      }),
    });
    if (!response.ok) {
      throw new Error(`Webhook responded with ${response.status} ${response.statusText}`);
    }
  }

  private format(notification: Notification): string {
    const emoji = LEVEL_EMOJI[notification.level ?? 'info'];
    const parts = [`${emoji} *${notification.title}*`, notification.body];
    if (notification.url) parts.push(notification.url);
    return parts.filter(Boolean).join('\n');
  }
}
