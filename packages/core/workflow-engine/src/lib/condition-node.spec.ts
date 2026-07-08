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

// A tiny inline `condition`-type executor: the engine condition-skips the node
// before this runs on the falsy path, so on the truthy path it simply completes.
const conditionExecutor: NodeExecutor = {
  type: 'condition',
  execute: async (ctx) => ({
    status: 'completed',
    output: { condition: ctx.nodeConfig.condition, result: true },
  }),
};

describe('condition node gating', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore({ ...baseRun });
  });

  function build(expr: string): {
    engine: WorkflowEngine;
    cfg: ProjectConfig;
    executed: string[];
    skipped: string[];
  } {
    const cfg = config([
      { id: 'source', type: 'shell', script: 'x', swimlane: 'doing' },
      { id: 'gate', type: 'condition', dependsOn: ['source'], condition: expr },
      { id: 'downstream', type: 'shell', script: 'x', dependsOn: ['gate'], swimlane: 'done' },
    ]);
    const executed: string[] = [];
    const skipped: string[] = [];
    const shell: NodeExecutor = {
      type: 'shell',
      execute: async (ctx) => {
        executed.push(ctx.node.nodeKey);
        if (ctx.node.nodeKey === 'source') {
          return { status: 'completed', output: { value: 42 } };
        }
        return { status: 'completed', output: { ok: true } };
      },
    };
    const engine = new WorkflowEngine({
      store,
      emit: async (e) => {
        if (e.type === 'node.skipped') skipped.push((e.payload as { nodeKey: string }).nodeKey);
      },
      moveTicket: async () => undefined,
      executors: [shell, conditionExecutor],
    });
    return { engine, cfg, executed, skipped };
  }

  const status = (key: string) => store.nodes.find((n) => n.nodeKey === key)?.status;

  it('runs the downstream branch when the condition is true', async () => {
    const { engine, cfg, executed } = build('nodes.source.value > 10');

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(run.status).toBe('completed');
    expect(executed).toEqual(['source', 'downstream']);
    expect(status('source')).toBe('completed');
    expect(status('gate')).toBe('completed');
    expect(status('downstream')).toBe('completed');
  });

  it('condition-skips the gate and cascades to the downstream branch when false', async () => {
    const { engine, cfg, executed, skipped } = build('nodes.source.value > 100');

    await engine.initializeNodes('run1', cfg);
    const run = await engine.advance({ ...store.run }, cfg, workspace);

    expect(run.status).toBe('completed');
    expect(executed).toEqual(['source']);
    expect(skipped.sort()).toEqual(['downstream', 'gate']);
    expect(status('gate')).toBe('skipped');
    expect(status('downstream')).toBe('skipped');
    const gate = store.nodes.find((n) => n.nodeKey === 'gate');
    expect(isConditionSkipped(gate!)).toBe(true);
  });
});
