import type { NodeExecutor, NodeExecutionContext, NodeOutcome } from '@orion/workflow-engine';

/**
 * Executes an `approval` node. Humans are a first-class node type: the executor
 * simply reports `waiting`, pausing the run until it is approved via the API.
 */
export class ApprovalNodeExecutor implements NodeExecutor {
  readonly type = 'approval' as const;

  async execute(ctx: NodeExecutionContext): Promise<NodeOutcome> {
    await ctx.emit('log', { message: 'Awaiting human approval' });
    return { status: 'waiting' };
  }
}
