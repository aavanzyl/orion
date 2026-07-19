import { describe, expect, it } from 'vitest';
import type { LinearClientLike, LinearIssueDTO, LinearTeamDTO, LinearWorkflowStateDTO } from '../index.js';

class FakeLinearClient implements LinearClientLike {
  issues: LinearIssueDTO[] = [
    {
      id: 'issue-1',
      identifier: 'TST-1',
      title: 'Setup CI',
      description: 'Configure GitHub Actions',
      stateId: 'state-todo',
      stateName: 'Todo',
      url: 'https://linear.app/issue/TST-1',
      priority: 1,
      dueDate: '2026-08-01',
      labels: [{ name: 'frontend', color: '#ff0000' }],
      epic: { id: 'proj-1', name: 'Platform', color: '#7c3aed' },
    },
    {
      id: 'issue-2',
      identifier: 'TST-2',
      title: 'Add tests',
      description: 'Write unit tests',
      stateId: 'state-in-progress',
      stateName: 'In Progress',
      url: 'https://linear.app/issue/TST-2',
      priority: 3,
      startedAt: '2026-07-01T12:00:00.000Z',
      labels: [{ name: 'backend' }],
    },
  ];

  workflowStates: LinearWorkflowStateDTO[] = [
    { id: 'state-todo', name: 'Todo', type: 'unstarted' },
    { id: 'state-in-progress', name: 'In Progress', type: 'started' },
    { id: 'state-done', name: 'Done', type: 'completed' },
  ];

  teams: LinearTeamDTO[] = [
    { id: 'team-1', name: 'Engineering', key: 'ENG' },
  ];

  private issueStates = new Map<string, string>();
  private comments: { issueId: string; body: string }[] = [];

  async listIssues(_teamId: string): Promise<LinearIssueDTO[]> {
    return this.issues;
  }

  async listWorkflowStates(_teamId: string): Promise<LinearWorkflowStateDTO[]> {
    return this.workflowStates;
  }

  async listTeams(): Promise<LinearTeamDTO[]> {
    return this.teams;
  }

  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    this.issueStates.set(issueId, stateId);
  }

  async createComment(issueId: string, body: string): Promise<void> {
    this.comments.push({ issueId, body });
  }

  getIssueState(issueId: string): string | undefined {
    return this.issueStates.get(issueId);
  }

  getComments(): { issueId: string; body: string }[] {
    return this.comments;
  }
}

describe('LinearBoardClient — fake client', () => {
  it('returns issues with DTO fields', async () => {
    const client = new FakeLinearClient();
    const issues = await client.listIssues('team-1');
    expect(issues).toHaveLength(2);
    expect(issues[0].id).toBe('issue-1');
    expect(issues[0].identifier).toBe('TST-1');
    expect(issues[0].title).toBe('Setup CI');
    expect(issues[0].description).toBe('Configure GitHub Actions');
    expect(issues[0].stateId).toBe('state-todo');
    expect(issues[0].stateName).toBe('Todo');
    expect(issues[0].url).toMatch(/linear\.app/);
  });

  it('returns enriched fields: priority, dueDate, labels, epic', async () => {
    const client = new FakeLinearClient();
    const issues = await client.listIssues('team-1');
    expect(issues[0].priority).toBe(1);
    expect(issues[0].dueDate).toBe('2026-08-01');
    expect(issues[0].labels).toEqual([{ name: 'frontend', color: '#ff0000' }]);
    expect(issues[0].epic).toEqual({ id: 'proj-1', name: 'Platform', color: '#7c3aed' });
    expect(issues[1].priority).toBe(3);
    expect(issues[1].startedAt).toBe('2026-07-01T12:00:00.000Z');
    expect(issues[1].labels).toEqual([{ name: 'backend' }]);
    expect(issues[1].epic).toBeUndefined();
  });

  it('returns workflow states', async () => {
    const client = new FakeLinearClient();
    const states = await client.listWorkflowStates('team-1');
    expect(states).toHaveLength(3);
    expect(states.map((s) => s.name)).toEqual(['Todo', 'In Progress', 'Done']);
  });

  it('returns teams', async () => {
    const client = new FakeLinearClient();
    const teams = await client.listTeams();
    expect(teams).toHaveLength(1);
    expect(teams[0].name).toBe('Engineering');
    expect(teams[0].key).toBe('ENG');
  });

  it('updates issue state', async () => {
    const client = new FakeLinearClient();
    await client.updateIssueState('issue-1', 'state-done');
    expect(client.getIssueState('issue-1')).toBe('state-done');
  });

  it('creates a comment', async () => {
    const client = new FakeLinearClient();
    await client.createComment('issue-1', 'PR opened');
    expect(client.getComments()).toEqual([
      { issueId: 'issue-1', body: 'PR opened' },
    ]);
  });
});
