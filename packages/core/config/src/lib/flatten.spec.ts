import { describe, it, expect } from 'vitest';
import type { ProjectConfig, WorkflowConfig } from '@orion/models';
import { flattenProjectConfig, flattenWorkflow } from './flatten.js';
import { ConfigError } from './errors.js';

const base: ProjectConfig = {
  project: { name: 'demo', defaultBranch: 'main' },
  board: { swimlanes: ['todo'] },
  workflow: { name: 'default', nodes: [] },
};

function makeConfig(overrides?: Partial<ProjectConfig>): ProjectConfig {
  if (overrides) return { ...base, ...overrides, workflow: { ...base.workflow, ...overrides.workflow } };
  return structuredClone(base);
}

describe('flattenProjectConfig', () => {
  it('returns the config unchanged when there are no workflows', () => {
    const config = makeConfig({
      workflow: {
        name: 'default',
        nodes: [{ id: 'a', type: 'shell', script: 'echo hi' }],
      },
    });
    const result = flattenProjectConfig(config);
    expect(result.workflow.nodes).toEqual([{ id: 'a', type: 'shell', script: 'echo hi' }]);
    expect(result.workflows).toBeUndefined();
    expect(result).toBe(config); // same reference when no flattening needed
  });

  it('inlines a single sub-workflow and wires dependencies correctly', () => {
    const config: ProjectConfig = {
      ...base,
      workflows: {
        build: { name: 'build', nodes: [
          { id: 'compile', type: 'shell', script: 'tsc' },
          { id: 'lint', type: 'shell', script: 'eslint', dependsOn: ['compile'] },
        ]},
      },
      workflow: {
        name: 'default',
        nodes: [
          { id: 'setup', type: 'shell', script: 'npm ci' },
          { id: 'ci', type: 'workflow', workflow: 'build', dependsOn: ['setup'] },
          { id: 'deploy', type: 'shell', script: 'deploy', dependsOn: ['ci'] },
        ],
      },
    };
    const result = flattenProjectConfig(config);
    const ids = result.workflow.nodes.map((n) => n.id);
    expect(ids).toEqual(['setup', 'compile', 'lint', 'deploy']);

    const compile = result.workflow.nodes.find((n) => n.id === 'compile')!;
    expect(compile.dependsOn).toEqual(['setup']);

    const lint = result.workflow.nodes.find((n) => n.id === 'lint')!;
    expect(lint.dependsOn).toEqual(['compile']);

    const deploy = result.workflow.nodes.find((n) => n.id === 'deploy')!;
    expect(deploy.dependsOn).toEqual(['lint']);
  });

  it('expands nested sub-workflows', () => {
    const config: ProjectConfig = {
      ...base,
      workflows: {
        check: { name: 'check', nodes: [
          { id: 'lint', type: 'shell', script: 'eslint' },
        ]},
        ci: { name: 'ci', nodes: [
          { id: 'verify', type: 'workflow', workflow: 'check' },
          { id: 'deploy', type: 'shell', script: 'deploy', dependsOn: ['verify'] },
        ]},
      },
      workflow: {
        name: 'default',
        nodes: [
          { id: 'ci_step', type: 'workflow', workflow: 'ci' },
        ],
      },
    };
    const result = flattenProjectConfig(config);
    const ids = result.workflow.nodes.map((n) => n.id);
    expect(ids).toEqual(['lint', 'deploy']);

    const deploy = result.workflow.nodes.find((n) => n.id === 'deploy')!;
    expect(deploy.dependsOn).toEqual(['lint']);
  });

  it('throws on reference cycle (direct self-reference)', () => {
    const workflows: Record<string, WorkflowConfig> = {
      loop: { name: 'loop', nodes: [
        { id: 'a', type: 'workflow', workflow: 'loop' },
      ]},
    };
    expect(() => flattenWorkflow(workflows.loop.nodes, workflows, 0, new Set())).toThrow(
      ConfigError,
    );
  });

  it('throws on reference cycle (A -> B -> A)', () => {
    const workflows: Record<string, WorkflowConfig> = {
      a: { name: 'a', nodes: [{ id: 'x', type: 'workflow', workflow: 'b' }] },
      b: { name: 'b', nodes: [{ id: 'y', type: 'workflow', workflow: 'a' }] },
    };
    expect(() => flattenWorkflow(workflows.a.nodes, workflows, 0, new Set())).toThrow(
      ConfigError,
    );
  });

  it('no workflow nodes remain after flatten', () => {
    const config: ProjectConfig = {
      ...base,
      workflows: {
        build: { name: 'build', nodes: [
          { id: 'compile', type: 'shell', script: 'tsc' },
        ]},
      },
      workflow: {
        name: 'default',
        nodes: [
          { id: 'ci', type: 'workflow', workflow: 'build' },
        ],
      },
    };
    const result = flattenProjectConfig(config);
    expect(result.workflow.nodes).toHaveLength(1);
    expect(result.workflow.nodes[0].type).toBe('shell');
  });

  it('preserves node ids unchanged', () => {
    const config: ProjectConfig = {
      ...base,
      workflows: {
        review: { name: 'review', nodes: [
          { id: 'classify', type: 'agent', provider: 'codex' },
          { id: 'fix', type: 'agent', provider: 'codex', dependsOn: ['classify'] },
        ]},
      },
      workflow: {
        name: 'default',
        nodes: [
          { id: 'review_step', type: 'workflow', workflow: 'review' },
        ],
      },
    };
    const result = flattenProjectConfig(config);
    expect(result.workflow.nodes[0].id).toBe('classify');
    expect(result.workflow.nodes[1].id).toBe('fix');
  });

  it('sub-roots with existing dependencies keep them when workflow node has no deps', () => {
    const config: ProjectConfig = {
      ...base,
      workflows: {
        build: { name: 'build', nodes: [
          { id: 'compile', type: 'shell', script: 'tsc' },
        ]},
      },
      workflow: {
        name: 'default',
        nodes: [
          { id: 'ci', type: 'workflow', workflow: 'build' },
        ],
      },
    };
    const result = flattenProjectConfig(config);
    const compile = result.workflow.nodes.find((n) => n.id === 'compile')!;
    expect(compile.dependsOn).toBeUndefined();
  });

  it('throws when max depth is exceeded', () => {
    const workflows: Record<string, WorkflowConfig> = {};
    for (let i = 0; i <= 21; i++) {
      workflows[`w${i}`] = {
        name: `w${i}`,
        nodes: [{ id: `n${i}`, type: 'workflow', workflow: `w${i + 1}` }],
      };
    }
    workflows[`w21`] = { name: 'w21', nodes: [{ id: 'leaf', type: 'shell', script: 'ok' }] };
    expect(() => flattenWorkflow(workflows.w0.nodes, workflows, 0, new Set())).toThrow(
      /max sub-workflow depth/,
    );
  });
});
