import { renderTemplate } from '@orion/config';
import type { NodeExecutor, NodeExecutionContext, NodeOutcome } from '@orion/workflow-engine';

/**
 * Posts a comment onto the run's ticket in the upstream tracker. Implemented by
 * {@link LinearSyncService} for Linear today; Jira and others can satisfy the
 * same seam later.
 */
export interface TicketCommenter {
  /** Post `body` as a comment on `ticketId`. Resolves whether or not a remote
   *  tracker is connected (no-op when the ticket is local). */
  postComment(ticketId: string, body: string): Promise<{ posted: boolean; target?: string }>;
}

/**
 * Executes a `comment` node: renders `message` and posts it as a comment on the
 * run's ticket via the injected {@link TicketCommenter} (Linear today; Jira and
 * others later, selectable via `provider`).
 */
export class CommentNodeExecutor implements NodeExecutor {
  readonly type = 'comment' as const;

  constructor(private readonly commenter: TicketCommenter) {}

  async execute(ctx: NodeExecutionContext): Promise<NodeOutcome> {
    const template = ctx.nodeConfig.message;
    if (!template) {
      return { status: 'failed', error: 'comment node has no message' };
    }
    const body = renderTemplate(template, {}, ctx.nodeOutputs);
    try {
      const result = await this.commenter.postComment(ctx.ticketId, body);
      await ctx.emit('log', {
        message: result.posted ? `Posted comment to ${result.target ?? 'tracker'}` : 'No tracker connected; comment skipped',
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
}
