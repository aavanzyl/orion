import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ProjectConfig,
  RunNode,
  RunNodeStatus,
  WorkflowNodeType,
  WorkflowRun,
} from '@orion/models';
import { WorkflowEngine, isConditionSkipped } from './engine.js';
import type { NodeExecutor } from './executor.js';
import type { RunStore } from './ports.js';

class InMemoryStore implements RunStore {
  nodes: RunNode[] = [];
  run: WorkflowRun;
  private seq = 0;

  constructor(run: WorkflowRun) {
    this.run = run;
  }

  async get(): Promise<WorkflowRun | null> {
    return { ...this.run };
  }

  async listNodes(): Promise<RunNode[]> {
    return this.nodes.map((n) => ({ ...n }));
  }

  async createNode(input: {
    runId: string;
    nodeKey: string;
    type: WorkflowNodeType;
    dependsOn: string[];
    status?: RunNodeStatus;
  }): Promise<RunNode> {
    const node: RunNode = {
      id: `n${this.seq++}`,
      runId: input.runId,
      nodeKey: input.nodeKey,
      type: input.type,
      status: input.status ?? 'pending',
      dependsOn: input.dependsOn,
    };
    this.nodes.push(node);
    return node;
  }

  async updateNode(id: string, patch: Partial<RunNode>): Promise<RunNode> {
    const node = this.nodes.find((n) => n.id === id);
    if (!node) throw new Error(`node ${id} not found`);
    Object.assign(node, patch);
    return { ...node };
  }

  async update(_id: string, patch: Partial<WorkflowRun>): Promise<WorkflowRun> {
    Object.assign(this.run, patch);
    return { ...this.run };
  }
}

const baseRun: WorkflowRun = {
  id: 'run1',
  ticketId: 't1',
  projectId: 'p1',
  workflowName: 'default',
  status: 'created',
  createdAt: '',
  updatedAt: '',
};

const workspace = {
  rootPath: '/wt',
  configRoot: '/wt',
  repos: [
    { name: 'repo', path: '/wt', originPath: '/repo', branch: 'b', baseBranch: 'main' },
  ],
};

function config(nodes: ProjectConfig['workflow']['nodes']): ProjectConfig {
  return {
    project: { name: 'p', defaultBranch: 'main' },
    board: { swimlanes: ['todo', 'doing', 'done'] },
    workflow: { name: 'default', nodes },
  };
}

const passExecutor = (type: WorkflowNodeType): NodeExecutor => ({
  type,
  execute: async () => ({ status: 'completed', output: { ok: true } }),
});

describe('WorkflowEngine', () => {
  let store: InMemoryStore;
  const moved: string[] = [];

  beforeEach(() => {
    store = new InMemoryStore({ ...baseRun });
    moved.length = 0;
  });

  it('runs a linear workflow to completion in dependency order', async () => {
    const cfg = config([
      { id: 'investigate', type: 'agent', provider: 'codex', swimlane: 'doing' },
      { id: 'implement', type: 'agent', provider: 'codex', dependsOn: ['investigate'], swimlane: 'doing' },
      { id: 'finish', type: 'shell', script: 'true', dependsOn: ['implement'], swimlane: 'done' },
    ]);
    const engine = new WorkflowEngine({
      store,
      emit: async () => undefined,
      moveTicket: async (_t, c) => {
        moved.push(c);
      },
      executors: [passExecutor('agent'), passExecutor('shell')],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(run.status).toBe('completed');
    expect(store.nodes.map((n) => n.status)).toEqual(['completed', 'completed', 'completed']);
    expect(moved).toEqual(['doing', 'doing', 'done']);
  });

  it('pauses on an approval node then resumes', async () => {
    const cfg = config([
      { id: 'implement', type: 'agent', provider: 'codex', swimlane: 'doing' },
      { id: 'approval', type: 'approval', dependsOn: ['implement'], swimlane: 'done' },
      { id: 'ship', type: 'shell', script: 'true', dependsOn: ['approval'], swimlane: 'done' },
    ]);
    const approvalExecutor: NodeExecutor = {
      type: 'approval',
      execute: async () => ({ status: 'waiting' }),
    };
    const engine = new WorkflowEngine({
      store,
      emit: async () => undefined,
      moveTicket: async () => undefined,
      executors: [passExecutor('agent'), approvalExecutor, passExecutor('shell')],
    });

    await engine.initializeNodes('run1', cfg);
    let run = await engine.advance({ ...store.run }, cfg, workspace);
    expect(run.status).toBe('waiting');
    expect(store.nodes.find((n) => n.nodeKey === 'ship')?.status).toBe('pending');

    run = await engine.approve({ ...store.run }, cfg, workspace, 'approval');
    expect(run.status).toBe('completed');
    expect(store.nodes.find((n) => n.nodeKey === 'ship')?.status).toBe('completed');
  });

  it('fails the run when a node fails', async () => {
    const cfg = config([{ id: 'boom', type: 'shell', script: 'false', swimlane: 'doing' }]);
    const failing: NodeExecutor = {
      type: 'shell',
      execute: async () => ({ status: 'failed', error: 'nope' }),
    };
    const engine = new WorkflowEngine({
      store,
      emit: async () => undefined,
      moveTicket: async () => undefined,
      executors: [failing],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);
    expect(run.status).toBe('failed');
    expect(store.nodes[0].status).toBe('failed');
  });

  it('retries a failing node and completes when a later attempt succeeds', async () => {
    const cfg = config([
      { id: 'flaky', type: 'shell', script: 'x', swimlane: 'doing', retries: 2, retryDelayMs: 0 },
    ]);
    let calls = 0;
    const retries: string[] = [];
    const flaky: NodeExecutor = {
      type: 'shell',
      execute: async () => {
        calls += 1;
        return calls < 3
          ? { status: 'failed', error: `attempt ${calls}` }
          : { status: 'completed', output: { calls } };
      },
    };
    const engine = new WorkflowEngine({
      store,
      emit: async (e) => {
        if (e.type === 'node.retry') retries.push(e.nodeId ?? 'x');
      },
      moveTicket: async () => undefined,
      executors: [flaky],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(calls).toBe(3);
    expect(retries).toHaveLength(2);
    expect(run.status).toBe('completed');
    expect(store.nodes[0].status).toBe('completed');
  });

  it('fails the run after exhausting all retries', async () => {
    const cfg = config([
      { id: 'boom', type: 'shell', script: 'x', swimlane: 'doing', retries: 1, retryDelayMs: 0 },
    ]);
    let calls = 0;
    const failing: NodeExecutor = {
      type: 'shell',
      execute: async () => {
        calls += 1;
        return { status: 'failed', error: 'always' };
      },
    };
    const engine = new WorkflowEngine({
      store,
      emit: async () => undefined,
      moveTicket: async () => undefined,
      executors: [failing],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(calls).toBe(2);
    expect(run.status).toBe('failed');
  });

  it('runs independent ready nodes in parallel (DAG fan-out)', async () => {
    const cfg = config([
      { id: 'a', type: 'shell', script: 'x', swimlane: 'doing' },
      { id: 'b', type: 'shell', script: 'x', swimlane: 'doing' },
    ]);
    let active = 0;
    let maxActive = 0;
    const parallel: NodeExecutor = {
      type: 'shell',
      execute: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
        return { status: 'completed' };
      },
    };
    const engine = new WorkflowEngine({
      store,
      emit: async () => undefined,
      moveTicket: async () => undefined,
      executors: [parallel],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(run.status).toBe('completed');
    expect(maxActive).toBe(2);
    expect(store.nodes.map((n) => n.status)).toEqual(['completed', 'completed']);
  });

  it('continues past an advisory continueOnError node that fails', async () => {
    const cfg = config([
      { id: 'lint', type: 'shell', script: 'x', swimlane: 'doing', continueOnError: true },
      { id: 'ship', type: 'shell', script: 'x', dependsOn: ['lint'], swimlane: 'done' },
    ]);
    const executor: NodeExecutor = {
      type: 'shell',
      execute: async (ctx) =>
        ctx.node.nodeKey === 'lint'
          ? { status: 'failed', error: 'lint failed' }
          : { status: 'completed' },
    };
    const engine = new WorkflowEngine({
      store,
      emit: async () => undefined,
      moveTicket: async () => undefined,
      executors: [executor],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(run.status).toBe('completed');
    expect(store.nodes.find((n) => n.nodeKey === 'lint')?.status).toBe('skipped');
    expect(store.nodes.find((n) => n.nodeKey === 'ship')?.status).toBe('completed');
  });

  it('times out a node that runs longer than its timeout', async () => {
    const cfg = config([{ id: 'slow', type: 'shell', script: 'x', swimlane: 'doing', timeoutMs: 10 }]);
    const slow: NodeExecutor = {
      type: 'shell',
      execute: (ctx) =>
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ status: 'completed' }), 10_000);
          ctx.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve({ status: 'completed' });
          });
        }),
    };
    const engine = new WorkflowEngine({
      store,
      emit: async () => undefined,
      moveTicket: async () => undefined,
      executors: [slow],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(run.status).toBe('failed');
    expect(store.nodes[0].error).toContain('timed out');
  });

  it('loops a node until the sentinel appears in output', async () => {
    const cfg = config([
      {
        id: 'implement',
        type: 'shell',
        script: 'x',
        swimlane: 'doing',
        loop: { maxIterations: 5, until: 'ALL_TASKS_COMPLETE' },
      },
    ]);
    let calls = 0;
    const looping: NodeExecutor = {
      type: 'shell',
      execute: async () => {
        calls += 1;
        return calls < 3
          ? { status: 'completed', output: { done: false } }
          : { status: 'completed', output: { message: 'ALL_TASKS_COMPLETE' } };
      },
    };
    const engine = new WorkflowEngine({
      store,
      emit: async () => undefined,
      moveTicket: async () => undefined,
      executors: [looping],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(calls).toBe(3);
    expect(run.status).toBe('completed');
    expect(store.nodes[0].status).toBe('completed');
  });

  it('fails a loop node after maxIterations without the sentinel', async () => {
    const cfg = config([
      {
        id: 'implement',
        type: 'shell',
        script: 'x',
        swimlane: 'doing',
        loop: { maxIterations: 3, until: 'ALL_TASKS_COMPLETE' },
      },
    ]);
    let calls = 0;
    const looping: NodeExecutor = {
      type: 'shell',
      execute: async () => {
        calls += 1;
        return { status: 'completed', output: { done: false } };
      },
    };
    const engine = new WorkflowEngine({
      store,
      emit: async () => undefined,
      moveTicket: async () => undefined,
      executors: [looping],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(calls).toBe(3);
    expect(run.status).toBe('failed');
    expect(store.nodes[0].status).toBe('failed');
    expect(store.nodes[0].error).toContain('maxIterations (3)');
  });

  it('passes upstream node outputs to downstream executors via ctx.nodeOutputs', async () => {
    const cfg = config([
      { id: 'investigate', type: 'shell', script: 'x', swimlane: 'doing', provider: 'codex' },
      { id: 'implement', type: 'shell', script: 'x', dependsOn: ['investigate'], swimlane: 'doing' },
    ]);
    const seenOutputs: Record<string, unknown>[] = [];
    const executor: NodeExecutor = {
      type: 'shell',
      execute: async (ctx) => {
        seenOutputs.push(ctx.nodeOutputs);
        if (ctx.node.nodeKey === 'investigate') {
          return { status: 'completed', output: { finalResponse: 'Use the portal gun' } };
        }
        return { status: 'completed' };
      },
    };
    const engine = new WorkflowEngine({
      store,
      emit: async () => undefined,
      moveTicket: async () => undefined,
      executors: [executor],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(run.status).toBe('completed');
    // First node should see empty outputs (no upstream nodes yet).
    expect(seenOutputs[0]).toEqual({});
    // Second node should see the investigate output.
    expect(seenOutputs[1]).toEqual({ investigate: { finalResponse: 'Use the portal gun' } });
  });

  it('emits node.iteration events and threads the threadId between iterations', async () => {
    const cfg = config([
      {
        id: 'implement',
        type: 'shell',
        script: 'x',
        swimlane: 'doing',
        loop: { maxIterations: 4, until: 'ALL_TASKS_COMPLETE' },
      },
    ]);
    const iterations: number[] = [];
    const seenThreadIds: (string | undefined)[] = [];
    let calls = 0;
    const looping: NodeExecutor = {
      type: 'shell',
      execute: async (ctx) => {
        calls += 1;
        seenThreadIds.push(ctx.run.threadId);
        return calls < 3
          ? { status: 'completed', output: { done: false }, threadId: `thread-${calls}` }
          : { status: 'completed', output: { message: 'ALL_TASKS_COMPLETE' } };
      },
    };
    const engine = new WorkflowEngine({
      store,
      emit: async (e) => {
        if (e.type === 'node.iteration') {
          iterations.push((e.payload as { iteration: number }).iteration);
        }
      },
      moveTicket: async () => undefined,
      executors: [looping],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(run.status).toBe('completed');
    expect(iterations).toEqual([1, 2, 3]);
    expect(seenThreadIds).toEqual([undefined, 'thread-1', 'thread-2']);
  });

  it('skips a branch gated by a false condition node and emits node.skipped', async () => {
    const cfg = config([
      { id: 'check', type: 'shell', script: 'x', swimlane: 'doing' },
      { id: 'gate', type: 'condition', dependsOn: ['check'], condition: 'nodes.check.value > 10' },
      { id: 'guarded', type: 'shell', script: 'x', dependsOn: ['gate'] },
    ]);
    const skipped: string[] = [];
    const executed: string[] = [];
    const shell: NodeExecutor = {
      type: 'shell',
      execute: async (ctx) => {
        executed.push(ctx.node.nodeKey);
        return { status: 'completed', output: { value: 5 } };
      },
    };
    const conditionExecutor: NodeExecutor = {
      type: 'condition',
      execute: async () => ({ status: 'completed', output: { result: true } }),
    };
    const engine = new WorkflowEngine({
      store,
      emit: async (e) => {
        if (e.type === 'node.skipped') skipped.push((e.payload as { nodeKey: string }).nodeKey);
      },
      moveTicket: async () => undefined,
      executors: [shell, conditionExecutor],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(run.status).toBe('completed');
    expect(executed).toEqual(['check']);
    expect(skipped.sort()).toEqual(['gate', 'guarded']);
    const guarded = store.nodes.find((n) => n.nodeKey === 'guarded');
    expect(guarded?.status).toBe('skipped');
    expect(isConditionSkipped(guarded!)).toBe(true);
  });

  it('skips a not-taken branch while a completed branch joins and the run completes', async () => {
    const cfg = config([
      { id: 'gateA', type: 'condition', condition: 'true' },
      { id: 'A2', type: 'shell', script: 'x', dependsOn: ['gateA'] },
      { id: 'gateB', type: 'condition', condition: 'false' },
      { id: 'B2', type: 'shell', script: 'x', dependsOn: ['gateB'] },
      { id: 'J', type: 'shell', script: 'x', dependsOn: ['A2', 'B2'] },
    ]);
    const executed: string[] = [];
    const skipped: string[] = [];
    const shell: NodeExecutor = {
      type: 'shell',
      execute: async (ctx) => {
        executed.push(ctx.node.nodeKey);
        return { status: 'completed', output: { ok: true } };
      },
    };
    const conditionExecutor: NodeExecutor = {
      type: 'condition',
      execute: async () => ({ status: 'completed', output: { result: true } }),
    };
    const engine = new WorkflowEngine({
      store,
      emit: async (e) => {
        if (e.type === 'node.skipped') skipped.push((e.payload as { nodeKey: string }).nodeKey);
      },
      moveTicket: async () => undefined,
      executors: [shell, conditionExecutor],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(run.status).toBe('completed');
    expect(executed.sort()).toEqual(['A2', 'J']);
    expect(skipped.sort()).toEqual(['B2', 'gateB']);
    const status = (key: string) => store.nodes.find((n) => n.nodeKey === key)?.status;
    expect(status('gateA')).toBe('completed');
    expect(status('A2')).toBe('completed');
    expect(status('J')).toBe('completed');
    expect(status('gateB')).toBe('skipped');
    expect(status('B2')).toBe('skipped');
  });

  it('does not cascade an advisory continueOnError skip to its dependents', async () => {
    const cfg = config([
      { id: 'lint', type: 'shell', script: 'x', swimlane: 'doing', continueOnError: true },
      { id: 'ship', type: 'shell', script: 'x', dependsOn: ['lint'], swimlane: 'done' },
    ]);
    const skipped: string[] = [];
    const executor: NodeExecutor = {
      type: 'shell',
      execute: async (ctx) =>
        ctx.node.nodeKey === 'lint'
          ? { status: 'failed', error: 'lint failed' }
          : { status: 'completed', output: { ok: true } },
    };
    const engine = new WorkflowEngine({
      store,
      emit: async (e) => {
        if (e.type === 'node.skipped') skipped.push((e.payload as { nodeKey: string }).nodeKey);
      },
      moveTicket: async () => undefined,
      executors: [executor],
    });

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(run.status).toBe('completed');
    const lint = store.nodes.find((n) => n.nodeKey === 'lint');
    expect(lint?.status).toBe('skipped');
    expect(isConditionSkipped(lint!)).toBe(false);
    expect(skipped).toEqual([]);
    expect(store.nodes.find((n) => n.nodeKey === 'ship')?.status).toBe('completed');
  });

});
