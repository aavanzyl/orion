import { describe, it, expect, vi } from 'vitest';
import { CommunicationRegistry } from '@orion/communication-core';
import type { Notification, Notifier } from '@orion/communication-core';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import type { WorkflowNodeConfig } from '@orion/models';
import { MessageNodeExecutor, type TicketCommenter } from './message.executor.js';
import type { AgentTextGenerator } from './agent-text.js';

class FakeNotifier implements Notifier {
  readonly notifications: Notification[] = [];
  constructor(
    readonly key: string,
    private readonly onNotify?: (n: Notification) => void,
  ) {}
  async notify(notification: Notification): Promise<void> {
    this.notifications.push(notification);
    this.onNotify?.(notification);
  }
}

const noopCommenter: TicketCommenter = {
  postComment: async () => ({ posted: false }),
};

const noopAgentText: AgentTextGenerator = {
  generate: async () => 'generated body',
};

function makeCtx(
  nodeConfig: Partial<WorkflowNodeConfig>,
  nodeOutputs: Record<string, unknown> = {},
): { ctx: NodeExecutionContext; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn(async () => undefined);
  const ctx = {
    nodeConfig: { id: 'm1', type: 'message', ...nodeConfig } as WorkflowNodeConfig,
    ticketId: 't1',
    nodeOutputs,
    emit,
    workspace: { rootPath: '/wt', configRoot: '/wt', repos: [] },
  } as unknown as NodeExecutionContext;
  return { ctx, emit };
}

describe('MessageNodeExecutor – notify target', () => {
  it('fails when a non-agent message node has no message', async () => {
    const executor = new MessageNodeExecutor(new CommunicationRegistry(), noopCommenter, noopAgentText);
    const { ctx } = makeCtx({ messageTarget: 'notify' });

    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('failed');
  });

  it('renders templates and delivers to every registered provider', async () => {
    const registry = new CommunicationRegistry();
    const a = new FakeNotifier('slack');
    const b = new FakeNotifier('discord');
    registry.register(a).register(b);
    const executor = new MessageNodeExecutor(registry, noopCommenter, noopAgentText);
    const { ctx } = makeCtx(
      { message: 'PR: {{ nodes.review.url }}', level: 'warn' },
      { review: { url: 'https://github.com/pr/9' } },
    );

    const outcome = await executor.execute(ctx);
    expect(outcome).toMatchObject({ status: 'completed', output: { delivered: 2 } });
    expect(a.notifications[0]).toMatchObject({ body: 'PR: https://github.com/pr/9', level: 'warn' });
  });

  it('targets a single provider via nodeConfig.provider', async () => {
    const registry = new CommunicationRegistry();
    const a = new FakeNotifier('slack');
    const b = new FakeNotifier('discord');
    registry.register(a).register(b);
    const executor = new MessageNodeExecutor(registry, noopCommenter, noopAgentText);
    const { ctx } = makeCtx({ message: 'hi', provider: 'discord' });

    const outcome = await executor.execute(ctx);
    expect(outcome).toMatchObject({ status: 'completed', output: { delivered: 1 } });
    expect(a.notifications).toHaveLength(0);
    expect(b.notifications).toHaveLength(1);
  });

  it('completes with delivered:0 when no providers are configured', async () => {
    const executor = new MessageNodeExecutor(new CommunicationRegistry(), noopCommenter, noopAgentText);
    const { ctx, emit } = makeCtx({ message: 'hi' });

    const outcome = await executor.execute(ctx);
    expect(outcome).toMatchObject({ status: 'completed', output: { delivered: 0 } });
    expect(emit).toHaveBeenCalled();
  });
});

describe('MessageNodeExecutor – comment target', () => {
  it('renders the message template and posts the rendered body', async () => {
    const postComment = vi.fn().mockResolvedValue({ posted: true, target: 'linear:issue-1' });
    const executor = new MessageNodeExecutor(
      new CommunicationRegistry(),
      { postComment },
      noopAgentText,
    );
    const { ctx } = makeCtx(
      { messageTarget: 'comment', message: 'Result: {{ nodes.investigate.finalResponse }}' },
      { investigate: { finalResponse: 'done' } },
    );

    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('completed');
    expect(postComment).toHaveBeenCalledWith('t1', 'Result: done');
  });

  it('fails when postComment throws', async () => {
    const postComment = vi.fn().mockRejectedValue(new Error('boom'));
    const executor = new MessageNodeExecutor(
      new CommunicationRegistry(),
      { postComment },
      noopAgentText,
    );
    const { ctx } = makeCtx({ messageTarget: 'comment', message: 'hello' });

    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error).toMatch(/comment failed: boom/);
  });
});

describe('MessageNodeExecutor – agent generated', () => {
  it('drafts the body via the agent text generator', async () => {
    const registry = new CommunicationRegistry();
    const notifier = new FakeNotifier('slack');
    registry.register(notifier);
    const generate = vi.fn().mockResolvedValue('Deploy succeeded');
    const executor = new MessageNodeExecutor(registry, noopCommenter, { generate });
    const { ctx } = makeCtx({ agentGenerated: true });

    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('completed');
    expect(generate).toHaveBeenCalled();
    expect(notifier.notifications[0].body).toBe('Deploy succeeded');
  });

  it('fails when the agent produces an empty message', async () => {
    const executor = new MessageNodeExecutor(new CommunicationRegistry(), noopCommenter, {
      generate: async () => '',
    });
    const { ctx } = makeCtx({ agentGenerated: true });

    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('failed');
  });
});
