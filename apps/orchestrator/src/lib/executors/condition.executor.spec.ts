import { describe, it, expect, vi } from 'vitest';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import { ConditionNodeExecutor } from './condition.executor.js';

function makeCtx(
  condition: string | undefined,
  nodeOutputs: Record<string, unknown> = {},
): { ctx: NodeExecutionContext; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn(async () => undefined);
  const ctx = {
    nodeConfig: { id: 'gate', type: 'condition', condition },
    nodeOutputs,
    emit,
  } as unknown as NodeExecutionContext;
  return { ctx, emit };
}

describe('ConditionNodeExecutor', () => {
  const executor = new ConditionNodeExecutor();

  it('fails when the node has no condition expression', async () => {
    const { ctx, emit } = makeCtx(undefined);
    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('failed');
    expect(emit).not.toHaveBeenCalled();
  });

  it('completes with result:true for a truthy expression', async () => {
    const { ctx, emit } = makeCtx('1 == 1');
    const outcome = await executor.execute(ctx);
    expect(outcome).toMatchObject({
      status: 'completed',
      output: { condition: '1 == 1', result: true },
    });
    expect(emit).toHaveBeenCalledWith('log', expect.objectContaining({ result: true }));
  });

  it('completes with result:false for a falsy expression (skipping is the engine\'s job)', async () => {
    const { ctx } = makeCtx('1 == 2');
    const outcome = await executor.execute(ctx);
    expect(outcome).toMatchObject({
      status: 'completed',
      output: { condition: '1 == 2', result: false },
    });
  });

  it('resolves nodes.<id>.<path> references from nodeOutputs', async () => {
    const { ctx } = makeCtx('nodes.x.y > 10', { x: { y: 42 } });
    const outcome = await executor.execute(ctx);
    expect(outcome).toMatchObject({
      status: 'completed',
      output: { result: true },
    });
  });

  it('fails on a malformed expression', async () => {
    const { ctx } = makeCtx('nodes.a ==');
    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toContain('condition expression error');
    }
  });
});
