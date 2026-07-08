import { describe, expect, it, vi } from 'vitest';
import type { WorkflowNodeConfig } from '@orion/models';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import { CommentNodeExecutor, type TicketCommenter } from './comment.executor.js';

function makeCtx(
  nodeConfig: Partial<WorkflowNodeConfig>,
  nodeOutputs: Record<string, unknown> = {},
): { ctx: NodeExecutionContext; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    nodeConfig: { id: 'c1', type: 'comment', ...nodeConfig } as WorkflowNodeConfig,
    ticketId: 't1',
    nodeOutputs,
    emit,
  } as unknown as NodeExecutionContext;
  return { ctx, emit };
}

function fakeCommenter(
  result: { posted: boolean; target?: string } | Error,
): TicketCommenter & { postComment: ReturnType<typeof vi.fn> } {
  const postComment =
    result instanceof Error
      ? vi.fn().mockRejectedValue(result)
      : vi.fn().mockResolvedValue(result);
  return { postComment } as TicketCommenter & { postComment: ReturnType<typeof vi.fn> };
}

describe('CommentNodeExecutor', () => {
  it('fails when the node has no message', async () => {
    const commenter = fakeCommenter({ posted: false });
    const { ctx } = makeCtx({ message: undefined });

    const outcome = await new CommentNodeExecutor(commenter).execute(ctx);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toMatch(/no message/i);
    }
    expect(commenter.postComment).not.toHaveBeenCalled();
  });

  it('renders the message template and posts the rendered body', async () => {
    const commenter = fakeCommenter({ posted: true, target: 'linear:issue-1' });
    const { ctx } = makeCtx(
      { message: 'Result: {{ nodes.investigate.finalResponse }}' },
      { investigate: { finalResponse: 'done' } },
    );

    await new CommentNodeExecutor(commenter).execute(ctx);

    expect(commenter.postComment).toHaveBeenCalledWith('t1', 'Result: done');
  });

  it('completes with posted:true output and emits a posted log', async () => {
    const commenter = fakeCommenter({ posted: true, target: 'linear:issue-1' });
    const { ctx, emit } = makeCtx({ message: 'hello' });

    const outcome = await new CommentNodeExecutor(commenter).execute(ctx);

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.output).toEqual({
        posted: true,
        target: 'linear:issue-1',
        body: 'hello',
      });
    }
    expect(emit).toHaveBeenCalledWith('log', expect.objectContaining({ posted: true }));
  });

  it('completes (not fails) when the ticket has no tracker connected', async () => {
    const commenter = fakeCommenter({ posted: false });
    const { ctx, emit } = makeCtx({ message: 'hello' });

    const outcome = await new CommentNodeExecutor(commenter).execute(ctx);

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.output).toEqual({ posted: false, target: undefined, body: 'hello' });
    }
    expect(emit).toHaveBeenCalledWith('log', expect.objectContaining({ posted: false }));
  });

  it('fails when postComment throws', async () => {
    const commenter = fakeCommenter(new Error('boom'));
    const { ctx } = makeCtx({ message: 'hello' });

    const outcome = await new CommentNodeExecutor(commenter).execute(ctx);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toMatch(/comment failed: boom/);
    }
  });
});
