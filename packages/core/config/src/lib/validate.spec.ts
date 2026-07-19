import { describe, it, expect } from 'vitest';
import type { ProjectConfig } from '@orion/models';
import { assertValidConfig } from './validate.js';

const base: ProjectConfig = {
  project: { name: 'demo', defaultBranch: 'main' },
  board: { swimlanes: ['todo'] },
  workflow: { name: 'default', nodes: [] },
};

describe('assertValidConfig – message nodes', () => {
  it('rejects a message node without a message when not agent-generated', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'message', swimlane: 'todo' }],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/no message set/);
  });

  it('accepts an agent-generated message node without a static message', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'message', agentGenerated: true, swimlane: 'todo' }],
      },
    };
    expect(() => assertValidConfig(config)).not.toThrow();
  });

  it('accepts a notify-target message node with a message', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [
          { id: 'n1', type: 'message', messageTarget: 'notify', message: 'done', swimlane: 'todo' },
        ],
      },
    };
    expect(() => assertValidConfig(config)).not.toThrow();
  });
});

describe('assertValidConfig – graphql nodes', () => {
  it('rejects a graphql node without a url', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'graphql', query: '{ me { id } }', swimlane: 'todo' }],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/no url set/);
  });

  it('rejects a graphql node without a query', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'graphql', url: 'https://api/graphql', swimlane: 'todo' }],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/no query set/);
  });

  it('accepts a valid graphql node', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [
          { id: 'n1', type: 'graphql', url: 'https://api/graphql', query: '{ me { id } }', swimlane: 'todo' },
        ],
      },
    };
    expect(() => assertValidConfig(config)).not.toThrow();
  });
});

describe('assertValidConfig – retry policy scope', () => {
  it('rejects retries on a shell node', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'shell', script: 'echo ok', retries: 2, swimlane: 'todo' }],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(/only agent, http and graphql nodes support retries/);
  });

  it('accepts a timeout on an http node', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'http', url: 'https://api/health', timeoutMs: 5000, swimlane: 'todo' }],
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
    expect(() => assertValidConfig(config)).toThrow(/loop but only agent nodes/);
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

describe('assertValidConfig – issue type workflow refs', () => {
  it('accepts issue types referencing the main workflow', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'shell', script: 'echo ok', swimlane: 'todo' }],
      },
      issueTypes: [
        { name: 'feature', label: 'Feature', workflow: 'default' },
        { name: 'bug', label: 'Bug', workflow: 'default' },
      ],
    };
    expect(() => assertValidConfig(config)).not.toThrow();
  });

  it('accepts issue types referencing a workflows map entry', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'shell', script: 'echo ok', swimlane: 'todo' }],
      },
      workflows: {
        'feature-flow': {
          name: 'feature-flow',
          nodes: [{ id: 'f1', type: 'shell', script: 'echo f' }],
        },
      },
      issueTypes: [
        { name: 'feature', label: 'Feature', workflow: 'feature-flow' },
      ],
    };
    expect(() => assertValidConfig(config)).not.toThrow();
  });

  it('rejects issue types referencing an unknown workflow', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'shell', script: 'echo ok', swimlane: 'todo' }],
      },
      issueTypes: [
        { name: 'feature', label: 'Feature', workflow: 'investigate-only' },
      ],
    };
    expect(() => assertValidConfig(config)).toThrow(/references unknown workflow/);
  });

  it('rejects issue types when workflow map exists but ref is unknown', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'shell', script: 'echo ok', swimlane: 'todo' }],
      },
      workflows: {
        'review': {
          name: 'review',
          nodes: [{ id: 'r1', type: 'approval' }],
        },
      },
      issueTypes: [
        { name: 'bug', label: 'Bug', workflow: 'review' },
        { name: 'feature', label: 'Feature', workflow: 'stale-ref' },
      ],
    };
    expect(() => assertValidConfig(config)).toThrow(/references unknown workflow.*stale-ref/);
  });

  it('accepts no issue types defined', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'n1', type: 'shell', script: 'echo ok', swimlane: 'todo' }],
      },
    };
    expect(() => assertValidConfig(config)).not.toThrow();
  });
});

describe('assertValidConfig – onFailureTransitionLimit scoping', () => {
  it('rejects onFailureTransitionLimit without onFailureTransitionTo', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [
          { id: 'n1', type: 'shell', script: 'echo ok', onFailureTransitionLimit: 5, swimlane: 'todo' },
        ],
      },
    };
    expect(() => assertValidConfig(config)).toThrow(
      /sets onFailureTransitionLimit but has no onFailureTransitionTo/,
    );
  });

  it('accepts onFailureTransitionLimit alongside onFailureTransitionTo', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [
          { id: 'flaky', type: 'shell', script: 'x', onFailureTransitionTo: 'fixer', onFailureTransitionLimit: 5, swimlane: 'todo' },
          { id: 'fixer', type: 'shell', script: 'x', dependsOn: ['flaky'] },
        ],
      },
    };
    expect(() => assertValidConfig(config)).not.toThrow();
  });
});
