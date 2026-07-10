import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '@orion/models';
import { deriveSwimlaneTriggers, entrySwimlane } from './derive-triggers.js';

const base: ProjectConfig = {
  project: { name: 'p', defaultBranch: 'main' },
  board: { swimlanes: ['backlog', 'triage', 'in_progress', 'review'] },
  workflow: {
    name: 'default',
    nodes: [
      { id: 'implement', type: 'agent', provider: 'codex', swimlane: 'in_progress' },
      { id: 'review', type: 'approval', dependsOn: ['implement'], swimlane: 'review' },
    ],
  },
};

describe('entrySwimlane', () => {
  it('returns the swimlane of the first node with no dependencies', () => {
    expect(entrySwimlane(base.workflow)).toBe('in_progress');
  });

  it('falls back to the first node when every node has a dependency', () => {
    expect(
      entrySwimlane({
        name: 'w',
        nodes: [
          { id: 'a', type: 'shell', script: 'x', dependsOn: ['b'], swimlane: 'triage' },
          { id: 'b', type: 'shell', script: 'y', dependsOn: ['a'], swimlane: 'review' },
        ],
      }),
    ).toBe('triage');
  });

  it('returns undefined when the entry node has no swimlane', () => {
    expect(
      entrySwimlane({ name: 'w', nodes: [{ id: 'a', type: 'shell', script: 'x' }] }),
    ).toBeUndefined();
  });
});

describe('deriveSwimlaneTriggers', () => {
  it('maps the entry swimlane to the top-level workflow name', () => {
    expect(deriveSwimlaneTriggers(base)).toEqual({ in_progress: ['default'] });
  });

  it('includes named sub-workflows keyed by their map key', () => {
    const config: ProjectConfig = {
      ...base,
      workflows: {
        'triage-flow': {
          name: 'triage-flow',
          nodes: [{ id: 'assess', type: 'approval', swimlane: 'triage' }],
        },
      },
    };
    expect(deriveSwimlaneTriggers(config)).toEqual({
      in_progress: ['default'],
      triage: ['triage-flow'],
    });
  });

  it('groups multiple workflows sharing a swimlane', () => {
    const config: ProjectConfig = {
      ...base,
      workflows: {
        alt: {
          name: 'alt',
          nodes: [{ id: 'go', type: 'agent', provider: 'codex', swimlane: 'in_progress' }],
        },
      },
    };
    expect(deriveSwimlaneTriggers(config)).toEqual({ in_progress: ['default', 'alt'] });
  });
});
