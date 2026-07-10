import { renderTemplate } from '@orion/config';
import type { NodeExecutor, NodeExecutionContext, NodeOutcome } from '@orion/workflow-engine';
import type { CommunicationRegistry, NotificationLevel } from '@orion/communication-core';
import type { AgentTextGenerator } from './agent-text.js';

/**
 * Posts a comment onto the run's ticket in the upstream tracker. Implemented by
 * {@link BoardSyncService}, which routes to whichever provider (Linear, Jira,
 * Trello) backs the project's board connection.
 */
export interface TicketCommenter {
  /** Post `body` as a comment on `ticketId`. Resolves whether or not a remote
   *  tracker is connected (no-op when the ticket is local). */
  postComment(ticketId: string, body: string): Promise<{ posted: boolean; target?: string }>;
}

const AGENT_MESSAGE_PROMPT = (target: string, guidance: string | undefined) =>
  `Write a concise ${target === 'comment' ? 'ticket comment' : 'status notification'} summarizing the outcome of the work completed in this repository for the current ticket. Base it on the actual changes made. Respond with only the message text, no preamble.${
    guidance ? `\n\nAdditional guidance:\n${guidance}` : ''
  }`;

/**
 * Executes a `message` node. It renders (or, when `agentGenerated`, drafts via a
 * harness) a body and delivers it either through the notification providers
 * (`messageTarget: 'notify'`, the default) or as a comment on the run's ticket
 * (`messageTarget: 'comment'`). This unifies the former `notify` and `comment`
 * node types behind one node with a target selector.
 */
export class MessageNodeExecutor implements NodeExecutor {
  readonly type = 'message' as const;

  constructor(
    private readonly communication: CommunicationRegistry,
    private readonly commenter: TicketCommenter,
    private readonly agentText: AgentTextGenerator,
  ) {}

  async execute(ctx: NodeExecutionContext): Promise<NodeOutcome> {
    const cfg = ctx.nodeConfig;
    const target = cfg.messageTarget ?? 'notify';

    let body: string;
    if (cfg.agentGenerated) {
      try {
        body = await this.agentText.generate({
          prompt: AGENT_MESSAGE_PROMPT(target, cfg.message),
          workingDirectory: ctx.workspace.rootPath,
          provider: cfg.provider,
          model: cfg.model,
          signal: ctx.signal,
        });
      } catch (err) {
        return {
          status: 'failed',
          error: `message generation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      if (!body) {
        return { status: 'failed', error: 'agent produced an empty message' };
      }
    } else {
      if (!cfg.message) {
        return { status: 'failed', error: 'message node has no message' };
      }
      body = renderTemplate(cfg.message, {}, ctx.nodeOutputs);
    }

    return target === 'comment'
      ? this.deliverComment(ctx, body)
      : this.deliverNotification(ctx, body);
  }

  private async deliverComment(ctx: NodeExecutionContext, body: string): Promise<NodeOutcome> {
    try {
      const result = await this.commenter.postComment(ctx.ticketId, body);
      await ctx.emit('log', {
        message: result.posted
          ? `Posted comment to ${result.target ?? 'tracker'}`
          : 'No tracker connected; comment skipped',
        posted: result.posted,
      });
      return { status: 'completed', output: { posted: result.posted, target: result.target, body } };
    } catch (err) {
      return {
        status: 'failed',
        error: `comment failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async deliverNotification(ctx: NodeExecutionContext, body: string): Promise<NodeOutcome> {
    const level: NotificationLevel = ctx.nodeConfig.level ?? 'info';
    const provider = ctx.nodeConfig.provider;

    const keys = provider ? [provider] : this.communication.keys();
    if (keys.length === 0) {
      await ctx.emit('log', { message: 'notify: no communication providers configured; skipping' });
      return { status: 'completed', output: { delivered: 0, message: body } };
    }

    const config = (ctx.nodeConfig.config ?? {}) as Record<string, unknown>;
    const channel = typeof config.channel === 'string' ? config.channel : undefined;
    const title =
      typeof config.title === 'string' ? renderTemplate(config.title, {}, ctx.nodeOutputs) : 'Orion';

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
      return {
        status: 'failed',
        error: `notify failed: ${errors.join('; ') || 'no provider delivered'}`,
      };
    }
    await ctx.emit('log', { message: `notify delivered to ${delivered} provider(s)`, delivered });
    return {
      status: 'completed',
      output: { delivered, message: body, errors: errors.length ? errors : undefined },
    };
  }
}
