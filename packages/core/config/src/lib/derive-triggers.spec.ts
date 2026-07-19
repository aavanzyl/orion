import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '@orion/models';
import {
  resolveWorkflowForTicketType,
  resolveIssueTypes,
  resolveTriggerWorkflowForSwimlane,
} from './derive-triggers.js';

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

describe('resolveWorkflowForTicketType', () => {
  it('returns the default workflow name when no issue types are configured', () => {
    expect(resolveWorkflowForTicketType(base, 'feature')).toBe('default');
  });

  it('returns the mapped workflow when issue type matches', () => {
    const config: ProjectConfig = {
      ...base,
      issueTypes: [
        { name: 'feature', label: 'Feature', workflow: 'feature-flow' },
        { name: 'bug', label: 'Bug', workflow: 'bug-fix' },
      ],
      workflows: {
        'feature-flow': {
          name: 'feature-flow',
          nodes: [{ id: 'do', type: 'shell', script: 'x' }],
        },
        'bug-fix': {
          name: 'bug-fix',
          nodes: [{ id: 'fix', type: 'shell', script: 'y' }],
        },
      },
    };
    expect(resolveWorkflowForTicketType(config, 'feature')).toBe('feature-flow');
    expect(resolveWorkflowForTicketType(config, 'bug')).toBe('bug-fix');
  });

  it('falls back to ticket workflowName when type has no mapping', () => {
    const config: ProjectConfig = {
      ...base,
      issueTypes: [
        { name: 'feature', label: 'Feature', workflow: 'feature-flow' },
      ],
    };
    expect(resolveWorkflowForTicketType(config, 'hotfix', 'override')).toBe('override');
  });

  it('falls back to default workflow when type is unmapped and no workflowName', () => {
    const config: ProjectConfig = {
      ...base,
      issueTypes: [
        { name: 'feature', label: 'Feature', workflow: 'feature-flow' },
      ],
    };
    expect(resolveWorkflowForTicketType(config, 'hotfix')).toBe('default');
  });

  it('returns default workflow when no config and no workflowName', () => {
    expect(resolveWorkflowForTicketType(base)).toBe('default');
  });
});

describe('resolveTriggerWorkflowForSwimlane', () => {
  it('returns the workflow name when a zero-dependency start node matches the swimlane', () => {
    expect(resolveTriggerWorkflowForSwimlane(base, 'in_progress')).toBe('default');
  });

  it('returns null when the swimlane belongs to a node with dependencies', () => {
    expect(resolveTriggerWorkflowForSwimlane(base, 'review')).toBeNull();
  });

  it('returns null when no node is associated with the swimlane', () => {
    expect(resolveTriggerWorkflowForSwimlane(base, 'backlog')).toBeNull();
    expect(resolveTriggerWorkflowForSwimlane(base, 'triage')).toBeNull();
  });

  it('resolves the workflow via the ticket type before matching', () => {
    const config: ProjectConfig = {
      ...base,
      issueTypes: [
        { name: 'feature', label: 'Feature', workflow: 'feature-flow' },
        { name: 'bug', label: 'Bug', workflow: 'bug-fix' },
      ],
      workflows: {
        'feature-flow': {
          name: 'feature-flow',
          nodes: [{ id: 'do', type: 'shell', script: 'x', swimlane: 'triage' }],
        },
        'bug-fix': {
          name: 'bug-fix',
          nodes: [
            { id: 'fix', type: 'shell', script: 'y', swimlane: 'in_progress' },
            { id: 'check', type: 'approval', dependsOn: ['fix'], swimlane: 'review' },
          ],
        },
      },
    };
    expect(resolveTriggerWorkflowForSwimlane(config, 'triage', 'feature')).toBe('feature-flow');
    expect(resolveTriggerWorkflowForSwimlane(config, 'in_progress', 'bug')).toBe('bug-fix');
    expect(resolveTriggerWorkflowForSwimlane(config, 'in_progress', 'feature')).toBeNull();
    expect(resolveTriggerWorkflowForSwimlane(config, 'review', 'bug')).toBeNull();
  });

  it('supports the explicit ticket workflowName override', () => {
    const config: ProjectConfig = {
      ...base,
      workflows: {
        hotfix: {
          name: 'hotfix',
          nodes: [{ id: 'patch', type: 'shell', script: 'z', swimlane: 'triage' }],
        },
      },
    };
    expect(resolveTriggerWorkflowForSwimlane(config, 'triage', undefined, 'hotfix')).toBe('hotfix');
    expect(resolveTriggerWorkflowForSwimlane(config, 'triage')).toBeNull();
  });

  it('returns null when start nodes have no swimlane association', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'implement', type: 'agent', provider: 'codex' }],
      },
    };
    expect(resolveTriggerWorkflowForSwimlane(config, 'backlog')).toBeNull();
    expect(resolveTriggerWorkflowForSwimlane(config, 'in_progress')).toBeNull();
  });

  it('returns the actual main workflow name when issue-type ref is broken and falls back', () => {
    const config: ProjectConfig = {
      ...base,
      workflow: {
        name: 'default',
        nodes: [{ id: 'implement', type: 'agent', provider: 'codex', swimlane: 'in_progress' }],
      },
      issueTypes: [
        { name: 'feature', label: 'Feature', workflow: 'investigate-only' },
      ],
    };
    expect(resolveTriggerWorkflowForSwimlane(config, 'in_progress', 'feature')).toBe('default');
  });
});

describe('resolveIssueTypes', () => {
  it('returns built-in defaults when no config is provided', () => {
    const types = resolveIssueTypes(null);
    expect(types).toEqual([
      { value: 'feature', label: 'Feature' },
      { value: 'bug', label: 'Bug' },
      { value: 'issue', label: 'Issue' },
      { value: 'hotfix', label: 'Hotfix' },
      { value: 'epic', label: 'Epic' },
    ]);
  });

  it('returns configured types with workflow refs, always including epic', () => {
    const config: ProjectConfig = {
      ...base,
      issueTypes: [
        { name: 'chore', label: 'Chore', workflow: 'default' },
        { name: 'incident', label: 'Incident', workflow: 'quick-fix' },
      ],
    };
    const types = resolveIssueTypes(config);
    expect(types).toEqual([
      { value: 'epic', label: 'Epic' },
      { value: 'chore', label: 'Chore', workflow: 'default' },
      { value: 'incident', label: 'Incident', workflow: 'quick-fix' },
    ]);
  });
});
