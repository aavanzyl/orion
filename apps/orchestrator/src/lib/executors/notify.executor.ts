import { renderTemplate } from '@orion/config';
import type { NodeExecutor, NodeExecutionContext, NodeOutcome } from '@orion/workflow-engine';
import type { CommunicationRegistry, NotificationLevel } from '@orion/communication-core';

/**
 * Executes a `notify` node: renders `message` and delivers it as a notification
 * through the communication registry (Slack today via a webhook notifier; Teams
 * and others later). When `provider` is set only that notifier is targeted;
 * otherwise every registered notifier receives the message. Delivery failures
 * are reported but a node only fails when no provider accepted the message.
 */
export class NotifyNodeExecutor implements NodeExecutor {
  readonly type = 'notify' as const;

  constructor(private readonly communication: CommunicationRegistry) {}

  async execute(ctx: NodeExecutionContext): Promise<NodeOutcome> {
    const template = ctx.nodeConfig.message;
    if (!template) {
      return { status: 'failed', error: 'notify node has no message' };
    }
    const body = renderTemplate(template, {}, ctx.nodeOutputs);
    const level: NotificationLevel = ctx.nodeConfig.level ?? 'info';
    const provider = ctx.nodeConfig.provider;

    const keys = provider ? [provider] : this.communication.keys();
    if (keys.length === 0) {
      await ctx.emit('log', { message: 'notify: no communication providers configured; skipping' });
      return { status: 'completed', output: { delivered: 0, message: body } };
    }

    const config = (ctx.nodeConfig.config ?? {}) as Record<string, unknown>;
    const channel = typeof config.channel === 'string' ? config.channel : undefined;
    const title = typeof config.title === 'string' ? renderTemplate(config.title, {}, ctx.nodeOutputs) : 'Orion';

    const notification = { title, body, level, ...(channel ? { channel } : {}) };
    const errors: string[] = [];
    let delivered = 0;
    for (const key of keys) {
      try {
        await this.communication.get(key).notify(notification);
        delivered++;
      } catch (err) {
        errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (delivered === 0) {
      return { status: 'failed', error: `notify failed: ${errors.join('; ') || 'no provider delivered'}` };
    }
    await ctx.emit('log', { message: `notify delivered to ${delivered} provider(s)`, delivered });
    return {
      status: 'completed',
      output: { delivered, message: body, errors: errors.length ? errors : undefined },
    };
  }
}
