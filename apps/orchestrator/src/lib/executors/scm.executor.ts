import type { NodeExecutor, NodeExecutionContext, NodeOutcome } from '@orion/workflow-engine';
import type { ScmProvider } from '@orion/scm-core';
import type { TicketRepository } from '@orion/db';
import { SCM_ACTIONS } from './scm-actions/index.js';

/**
 * Executes an `scm` node by dispatching its `action` through the SCM action
 * registry (see `./scm-actions`). Supported actions: `checkout_branch`,
 * `open_pull_request`, `tag_release`, `merge`, `review`.
 */
export class ScmNodeExecutor implements NodeExecutor {
  readonly type = 'scm' as const;

  constructor(
    private readonly scm: ScmProvider,
    private readonly tickets: TicketRepository,
  ) {}

  async execute(ctx: NodeExecutionContext): Promise<NodeOutcome> {
    const action = ctx.nodeConfig.action;
    if (!action) {
      return { status: 'failed', error: 'scm node has no action' };
    }
    const handler = SCM_ACTIONS[action];
    if (!handler) {
      return { status: 'failed', error: `Unsupported scm action "${action}"` };
    }
    return handler(ctx, { scm: this.scm, tickets: this.tickets });
  }
}
