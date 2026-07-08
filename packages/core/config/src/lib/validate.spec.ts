import { describe, it, expect } from 'vitest';
import type { ProjectConfig } from '@orion/models';
import { assertValidConfig } from './validate.js';

const base: ProjectConfig = {
  project: { name: 'demo', defaultBranch: 'main' },
  board: { swimlanes: ['todo'] },
  workflow: { name: 'default', nodes: [] },
};

describe('assertValidConfig – structuredOutput', () => {
  it('rejects structuredOutput on a non-agent node', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [
          {
            id: 'n1',
            type: 'shell',
            script: 'echo ok',
            swimlane: 'todo',
            structuredOutput: { schema: { result: 'string' } },
          },
        ],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/only agent nodes/);
  });

  it('rejects structuredOutput with a required key not in the schema', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [
          {
            id: 'n1',
            type: 'agent',
            provider: 'codex',
            swimlane: 'todo',
            structuredOutput: { schema: { severity: 'string' }, required: ['nope'] },
          },
        ],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/not in the schema/);
  });

  it('accepts a valid structuredOutput on an agent node', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [
          {
            id: 'classify',
            type: 'agent',
            provider: 'codex',
            swimlane: 'todo',
            structuredOutput: { schema: { severity: 'string', areas: 'array' }, required: ['severity'] },
          },
        ],
      },
    };
    expect(() => assertValidConfig(config)).not.toThrow();
  });
});

describe('assertValidConfig – matrix', () => {
  it('rejects matrix on an scm node', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'scm', action: 'open_pull_request', matrix: { items: ['a'] } }],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/only agent and shell nodes may fan out/);
  });

  it('rejects matrix on an approval node', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'approval', matrix: { items: ['a'] } }],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/only agent and shell nodes may fan out/);
  });

  it('rejects combining matrix with loop', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [
          {
            id: 'n1',
            type: 'shell',
            script: 'echo $MATRIX_ITEM',
            matrix: { items: ['a', 'b'] },
            loop: { maxIterations: 2, until: 'DONE' },
          },
        ],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/cannot combine matrix with loop/);
  });

  it('accepts matrix on a shell node', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'shell', script: 'echo $MATRIX_ITEM', matrix: { items: ['a', 'b'] } }],
      },
    };
    expect(() => assertValidConfig(config)).not.toThrow();
  });

  it('accepts matrix with a node-output reference string', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [
          { id: 'plan', type: 'agent', provider: 'codex' },
          {
            id: 'fanout',
            type: 'agent',
            provider: 'codex',
            dependsOn: ['plan'],
            matrix: { items: 'nodes.plan.data.files' },
          },
        ],
      },
    };
    expect(() => assertValidConfig(config)).not.toThrow();
  });
});

describe('assertValidConfig – sub-workflows', () => {
  it('rejects a workflow node with missing workflow reference', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'workflow' }],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/no workflow reference/);
  });

  it('rejects a workflow node referencing an unknown sub-workflow', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'workflow', workflow: 'nonexistent' }],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/unknown sub-workflow/);
  });

  it('rejects duplicate node ids in flattened graph', () => {
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
          { id: 'compile', type: 'shell', script: 'npm ci' },
          { id: 'build_step', type: 'workflow', workflow: 'build' },
        ],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/globally unique/);
  });

  it('rejects sub-workflow with reference cycle', () => {
    const config: ProjectConfig = {
      ...base,
      workflows: {
        a: { name: 'a', nodes: [{ id: 'x', type: 'workflow', workflow: 'b' }] },
        b: { name: 'b', nodes: [{ id: 'y', type: 'workflow', workflow: 'a' }] },
      },
      workflow: {
        name: 'default',
        nodes: [{ id: 'start', type: 'workflow', workflow: 'a' }],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/cycle/);
  });

  it('validates sub-workflow nodes (missing provider)', () => {
    const config: ProjectConfig = {
      ...base,
      workflows: {
        review: { name: 'review', nodes: [
          { id: 'classify', type: 'agent' },
        ]},
      },
      workflow: {
        name: 'default',
        nodes: [
          { id: 'review_step', type: 'workflow', workflow: 'review' },
        ],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/no provider set/);
  });

  it('validates sub-workflow nodes (type rules)', () => {
    const config: ProjectConfig = {
      ...base,
      workflows: {
        bad: { name: 'bad', nodes: [
          { id: 'n1', type: 'approval', loop: { maxIterations: 3, until: 'done' } },
        ]},
      },
      workflow: {
        name: 'default',
        nodes: [
          { id: 'call', type: 'workflow', workflow: 'bad' },
        ],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/loop but only agent and shell/);
  });

  it('accepts a valid composed config with sub-workflows', () => {
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
    expect(() => assertValidConfig(config)).not.toThrow();
  });

  it('accepts config without workflows/flow nodes behaving as before', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [
          { id: 'a', type: 'shell', script: 'echo ok' },
          { id: 'b', type: 'shell', script: 'echo done', dependsOn: ['a'] },
        ],
      },
    };
    expect(() => assertValidConfig(config)).not.toThrow();
  });
});
