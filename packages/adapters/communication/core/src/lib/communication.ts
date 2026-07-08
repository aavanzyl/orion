import type { Keyed } from '@orion/adapter-kit';
import { ProviderRegistry } from '@orion/adapter-kit';

export type NotificationLevel = 'info' | 'warn' | 'error';

export interface Notification {
  title: string;
  body: string;
  level?: NotificationLevel;
  url?: string;
  /**
   * Optional channel/target override (e.g. a Slack channel like `#deploys`).
   * Notifiers that support routing per message honor it; others ignore it.
   */
  channel?: string;
}

/**
 * Outbound communication adapter (Slack, Discord, Telegram later). Interface
 * only for now; the engine can publish run status without knowing the channel.
 */
export interface Notifier extends Keyed {
  notify(notification: Notification): Promise<void>;
}

export class CommunicationRegistry extends ProviderRegistry<Notifier> {
  constructor() {
    super('communication');
  }
}
