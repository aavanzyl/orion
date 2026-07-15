import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '@orion/models';
import { resolveWorkflowForTicketType, resolveIssueTypes } from './derive-triggers.js';

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
