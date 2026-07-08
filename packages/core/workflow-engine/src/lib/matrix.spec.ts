import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ProjectConfig,
  RunNode,
  RunNodeStatus,
  WorkflowNodeType,
  WorkflowRun,
} from '@orion/models';
import { WorkflowEngine } from './engine.js';
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
  repos: [{ name: 'repo', path: '/wt', originPath: '/repo', branch: 'b', baseBranch: 'main' }],
};

function config(nodes: ProjectConfig['workflow']['nodes']): ProjectConfig {
  return {
    project: { name: 'p', defaultBranch: 'main' },
    board: { swimlanes: ['todo', 'doing', 'done'] },
    workflow: { name: 'default', nodes },
  };
}

describe('WorkflowEngine matrix fan-out', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore({ ...baseRun });
  });

  it('bounds concurrency to maxParallel and preserves output order', async () => {
    const cfg = config([
      {
        id: 'fanout',
        type: 'shell',
        script: 'x',
        swimlane: 'doing',
        matrix: { items: [0, 1, 2, 3, 4], maxParallel: 2 },
      },
    ]);

    let active = 0;
    let peak = 0;
    const executor: NodeExecutor = {
      type: 'shell',
      execute: async (ctx) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active -= 1;
        return { status: 'completed', output: ctx.matrix?.index };
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
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBe(2);
    const node = store.nodes.find((n) => n.nodeKey === 'fanout');
    expect(node?.output).toEqual({ items: [0, 1, 2, 3, 4] });
  });

  it('passes the `as` name through to the executor matrix context', async () => {
    const cfg = config([
      {
        id: 'fanout',
        type: 'shell',
        script: 'x',
        swimlane: 'doing',
        matrix: { items: ['a', 'b'], as: 'file' },
      },
    ]);

    const seenAs: (string | undefined)[] = [];
    const executor: NodeExecutor = {
      type: 'shell',
      execute: async (ctx) => {
        seenAs.push(ctx.matrix?.as);
        return { status: 'completed', output: ctx.matrix?.index };
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
    expect(seenAs).toEqual(['file', 'file']);
    const node = store.nodes.find((n) => n.nodeKey === 'fanout');
    expect(node?.output).toEqual({ items: [0, 1] });
  });
});
