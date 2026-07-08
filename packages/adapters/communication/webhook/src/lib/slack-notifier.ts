import { WebhookNotifier } from './webhook-notifier.js';

export interface SlackNotifierOptions {
  /** Slack incoming-webhook URL that receives a JSON POST for every notification. */
  url: string;
  /** Registry key; defaults to `slack`. */
  key?: string;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
  /** Injectable fetch implementation (defaults to the global `fetch`). */
  fetchImpl?: typeof fetch;
}

/**
 * Slack incoming-webhook notifier. Reuses the generic {@link WebhookNotifier}
 * payload (which already carries a Slack-compatible `text` field) and defaults
 * the registry key to `slack`.
 */
export class SlackNotifier extends WebhookNotifier {
  constructor(options: SlackNotifierOptions) {
    super({ ...options, key: options.key ?? 'slack' });
  }
}
