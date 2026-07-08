import { tryEvaluateCondition } from '@orion/config';
import type { NodeExecutor, NodeExecutionContext, NodeOutcome } from '@orion/workflow-engine';

/**
 * Executes a `condition` node. The node's `condition` expression is evaluated by
 * the engine *before* the executor runs: when it is false the node (and its
 * exclusive downstream branch) is condition-skipped, so this executor only runs
 * on the truthy path. It re-evaluates the expression to record the decision as
 * this node's output for downstream data-flow/observability.
 */
export class ConditionNodeExecutor implements NodeExecutor {
  readonly type = 'condition' as const;

  async execute(ctx: NodeExecutionContext): Promise<NodeOutcome> {
    const expr = ctx.nodeConfig.condition;
    if (!expr) {
      return { status: 'failed', error: 'condition node has no condition expression' };
    }
    const evaluated = tryEvaluateCondition(expr, ctx.nodeOutputs);
    if (!evaluated.ok) {
      return { status: 'failed', error: `condition expression error: ${evaluated.error}` };
    }
    await ctx.emit('log', { message: `condition "${expr}" => ${evaluated.value}`, result: evaluated.value });
    return { status: 'completed', output: { condition: expr, result: evaluated.value } };
  }
}
