import { describe, it, expect, vi } from 'vitest';
import { CommunicationRegistry } from '@orion/communication-core';
import type { Notification, Notifier } from '@orion/communication-core';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import type { WorkflowNodeConfig } from '@orion/models';
import { NotifyNodeExecutor } from './notify.executor.js';

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

function makeCtx(
  nodeConfig: WorkflowNodeConfig,
  nodeOutputs: Record<string, unknown> = {},
): { ctx: NodeExecutionContext; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn(async () => undefined);
  const ctx = { nodeConfig, nodeOutputs, emit } as unknown as NodeExecutionContext;
  return { ctx, emit };
}

describe('NotifyNodeExecutor', () => {
  it('fails when the node has no message', async () => {
    const registry = new CommunicationRegistry();
    const executor = new NotifyNodeExecutor(registry);
    const { ctx } = makeCtx({ type: 'notify' } as WorkflowNodeConfig);

    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('failed');
  });

  it('renders {{ nodes.x.y }} templates against nodeOutputs', async () => {
    const registry = new CommunicationRegistry();
    const notifier = new FakeNotifier('slack');
    registry.register(notifier);
    const executor = new NotifyNodeExecutor(registry);
    const { ctx } = makeCtx(
      { type: 'notify', message: 'PR: {{ nodes.review.url }}' } as WorkflowNodeConfig,
      { review: { url: 'https://github.com/pr/9' } },
    );

    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('completed');
    expect(notifier.notifications[0].body).toBe('PR: https://github.com/pr/9');
  });

  it('delivers to every registered provider when no provider is set', async () => {
    const registry = new CommunicationRegistry();
    const a = new FakeNotifier('slack');
    const b = new FakeNotifier('discord');
    registry.register(a).register(b);
    const executor = new NotifyNodeExecutor(registry);
    const { ctx } = makeCtx({ type: 'notify', message: 'hi', level: 'warn' } as WorkflowNodeConfig);

    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('completed');
    expect(outcome).toMatchObject({ output: { delivered: 2 } });
    expect(a.notifications[0]).toMatchObject({ title: 'Orion', body: 'hi', level: 'warn' });
    expect(b.notifications).toHaveLength(1);
  });

  it('targets a single provider via nodeConfig.provider', async () => {
    const registry = new CommunicationRegistry();
    const a = new FakeNotifier('slack');
    const b = new FakeNotifier('discord');
    registry.register(a).register(b);
    const executor = new NotifyNodeExecutor(registry);
    const { ctx } = makeCtx({ type: 'notify', message: 'hi', provider: 'discord' } as WorkflowNodeConfig);

    const outcome = await executor.execute(ctx);
    expect(outcome).toMatchObject({ status: 'completed', output: { delivered: 1 } });
    expect(a.notifications).toHaveLength(0);
    expect(b.notifications).toHaveLength(1);
  });

  it('fails when targeting an unknown provider key', async () => {
    const registry = new CommunicationRegistry();
    registry.register(new FakeNotifier('slack'));
    const executor = new NotifyNodeExecutor(registry);
    const { ctx } = makeCtx({ type: 'notify', message: 'hi', provider: 'nope' } as WorkflowNodeConfig);

    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('failed');
  });

  it('completes with delivered:0 when no providers are configured', async () => {
    const registry = new CommunicationRegistry();
    const executor = new NotifyNodeExecutor(registry);
    const { ctx, emit } = makeCtx({ type: 'notify', message: 'hi' } as WorkflowNodeConfig);

    const outcome = await executor.execute(ctx);
    expect(outcome).toMatchObject({ status: 'completed', output: { delivered: 0 } });
    expect(emit).toHaveBeenCalled();
  });

  it('reports a throwing notifier in errors while others still deliver', async () => {
    const registry = new CommunicationRegistry();
    const bad = new FakeNotifier('slack', () => {
      throw new Error('boom');
    });
    const good = new FakeNotifier('discord');
    registry.register(bad).register(good);
    const executor = new NotifyNodeExecutor(registry);
    const { ctx } = makeCtx({ type: 'notify', message: 'hi' } as WorkflowNodeConfig);

    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('completed');
    expect(outcome).toMatchObject({ output: { delivered: 1 } });
    const output = (outcome as { output: { errors?: string[] } }).output;
    expect(output.errors?.[0]).toContain('boom');
    expect(good.notifications).toHaveLength(1);
  });
});
