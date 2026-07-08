import { describe, expect, it, vi } from 'vitest';
import type { LinearClientLike } from '@orion/board-linear';
import type { BoardRegistry } from '@orion/board-core';
import type { BoardConnectionRepository, ProjectRepository, TicketRepository } from '@orion/db';
import { LinearSyncService, type LinearClientFactory } from './linear-sync.service.js';

interface FakeState {
  issueState?: Record<string, string>;
}

function fakeClient(states?: FakeState): LinearClientLike {
  return {
    listIssues: vi.fn().mockResolvedValue([
      {
        id: 'issue-1',
        identifier: 'TST-1',
        title: 'Setup CI',
        description: 'Configure CI',
        stateId: 'state-todo',
        stateName: 'Todo',
        url: 'https://linear.app/issue/TST-1',
      },
      {
        id: 'issue-2',
        identifier: 'TST-2',
        title: 'Add tests',
        description: 'Write tests',
        stateId: 'state-in-progress',
        stateName: 'In Progress',
        url: 'https://linear.app/issue/TST-2',
      },
    ]),
    listWorkflowStates: vi.fn().mockResolvedValue([
      { id: 'state-todo', name: 'Todo', type: 'unstarted' },
      { id: 'state-in-progress', name: 'In Progress', type: 'started' },
      { id: 'state-done', name: 'Done', type: 'completed' },
    ]),
    listTeams: vi.fn().mockResolvedValue([
      { id: 'team-1', name: 'Engineering', key: 'ENG' },
    ]),
    updateIssueState: vi.fn().mockImplementation(async (issueId: string, stateId: string) => {
      if (states) {
        states.issueState = { ...states.issueState, [issueId]: stateId };
      }
    }),
    createComment: vi.fn().mockResolvedValue(undefined),
  };
}

function mockRepos() {
  return {
    boardConnections: {
      getByProject: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      touchSynced: vi.fn(),
    } as unknown as BoardConnectionRepository,
    tickets: {
      get: vi.fn(),
      getByExternal: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    } as unknown as TicketRepository,
    projects: {
      get: vi.fn(),
    } as unknown as ProjectRepository,
    boards: {
      get: vi.fn(),
    } as unknown as BoardRegistry,
  };
}

describe('LinearSyncService', () => {
  it('pushTicketState no-ops when ticket is native', async () => {
    const repos = mockRepos();
    (repos.tickets.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      source: 'native',
      externalId: null,
      column: 'todo',
    });
    const factory: LinearClientFactory = () => fakeClient();
    const svc = new LinearSyncService(
      repos.boardConnections,
      repos.tickets,
      repos.projects,
      repos.boards,
      factory,
    );

    await svc.pushTicketState('t1');
    expect(repos.boardConnections.getByProject).not.toHaveBeenCalled();
  });

  it('pushTicketState no-ops when no connection', async () => {
    const repos = mockRepos();
    (repos.tickets.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      source: 'linear',
      externalId: 'issue-1',
      column: 'todo',
    });
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const factory: LinearClientFactory = () => fakeClient();
    const svc = new LinearSyncService(
      repos.boardConnections,
      repos.tickets,
      repos.projects,
      repos.boards,
      factory,
    );

    await svc.pushTicketState('t1');
    expect(repos.boardConnections.getByProject).toHaveBeenCalledWith('p1');
  });

  it('pushTicketState pushes state update', async () => {
    const repos = mockRepos();
    (repos.tickets.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      source: 'linear',
      externalId: 'issue-1',
      swimlane: 'in_progress',
    });
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      projectId: 'p1',
      apiKey: 'key',
      enabled: true,
      stateMap: { in_progress: 'state-in-progress' },
    });
    const states: FakeState = {};
    const factory: LinearClientFactory = () => fakeClient(states);
    const svc = new LinearSyncService(
      repos.boardConnections,
      repos.tickets,
      repos.projects,
      repos.boards,
      factory,
    );

    await svc.pushTicketState('t1');
    expect(states.issueState?.['issue-1']).toBe('state-in-progress');
  });

  it('pushTicketState no-ops when column not in stateMap', async () => {
    const repos = mockRepos();
    (repos.tickets.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      source: 'linear',
      externalId: 'issue-1',
      column: 'unknown',
    });
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      projectId: 'p1',
      apiKey: 'key',
      enabled: true,
      stateMap: { todo: 'state-todo' },
    });
    const states: FakeState = {};
    const factory: LinearClientFactory = () => fakeClient(states);
    const svc = new LinearSyncService(
      repos.boardConnections,
      repos.tickets,
      repos.projects,
      repos.boards,
      factory,
    );

    await svc.pushTicketState('t1');
    expect(states.issueState).toBeUndefined();
  });

  it('postComment no-ops for a local ticket', async () => {
    const repos = mockRepos();
    (repos.tickets.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      source: 'native',
      externalId: null,
    });
    const client = fakeClient();
    const factory: LinearClientFactory = () => client;
    const svc = new LinearSyncService(
      repos.boardConnections,
      repos.tickets,
      repos.projects,
      repos.boards,
      factory,
    );

    const result = await svc.postComment('t1', 'hello');

    expect(result).toEqual({ posted: false });
    expect(client.createComment).not.toHaveBeenCalled();
    expect(repos.boardConnections.getByProject).not.toHaveBeenCalled();
  });

  it('postComment posts to Linear when a connection is active', async () => {
    const repos = mockRepos();
    (repos.tickets.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      source: 'linear',
      externalId: 'issue-1',
    });
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      projectId: 'p1',
      apiKey: 'key',
      enabled: true,
      stateMap: {},
    });
    const client = fakeClient();
    const factory: LinearClientFactory = () => client;
    const svc = new LinearSyncService(
      repos.boardConnections,
      repos.tickets,
      repos.projects,
      repos.boards,
      factory,
    );

    const result = await svc.postComment('t1', 'hello');

    expect(client.createComment).toHaveBeenCalledWith('issue-1', 'hello');
    expect(result).toEqual({ posted: true, target: 'linear:issue-1' });
  });

  it('syncNow creates new tickets from Linear issues', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      apiKey: 'key',
      enabled: true,
      teamId: 'team-1',
      stateMap: { 'state-todo': 'backlog' },
    });
    (repos.projects.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'p1',
      name: 'Test',
      boardProvider: 'native',
    });
    (repos.boards.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getBoard: vi.fn().mockResolvedValue({
        projectId: 'p1',
        swimlanes: [
          { key: 'backlog', title: 'Backlog', tickets: [] },
          { key: 'in_progress', title: 'In Progress', tickets: [] },
        ],
      }),
    });
    (repos.tickets.getByExternal as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (repos.tickets.create as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { title: string; description: string; swimlane: string }) => ({
        id: 'new-' + input.title,
        ...input,
      }),
    );

    const factory: LinearClientFactory = () => fakeClient();
    const svc = new LinearSyncService(
      repos.boardConnections,
      repos.tickets,
      repos.projects,
      repos.boards,
      factory,
    );

    const result = await svc.syncNow('p1');

    expect(result.imported).toBeGreaterThanOrEqual(1);
    expect(repos.tickets.create).toHaveBeenCalled();
    expect(repos.boardConnections.touchSynced).toHaveBeenCalled();
  });

  it('syncNow updates existing tickets', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      apiKey: 'key',
      enabled: true,
      teamId: 'team-1',
      stateMap: { 'state-todo': 'backlog' },
    });
    (repos.projects.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'p1',
      name: 'Test',
      boardProvider: 'native',
    });
    (repos.boards.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getBoard: vi.fn().mockResolvedValue({
        projectId: 'p1',
        swimlanes: [
          { key: 'backlog', title: 'Backlog', tickets: [] },
        ],
      }),
    });
    (repos.tickets.getByExternal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: 't-exists',
        projectId: 'p1',
        title: 'Old title',
        description: 'Old desc',
        swimlane: 'other',
      })
      .mockResolvedValueOnce(null);
    (repos.tickets.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (repos.tickets.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const factory: LinearClientFactory = () => fakeClient();
    const svc = new LinearSyncService(
      repos.boardConnections,
      repos.tickets,
      repos.projects,
      repos.boards,
      factory,
    );

    const result = await svc.syncNow('p1');

    expect(result.updated).toBe(1);
    expect(repos.tickets.update).toHaveBeenCalledWith('t-exists', {
      title: 'Setup CI',
      description: 'Configure CI',
      swimlane: 'backlog',
    });
    expect(repos.tickets.create).toHaveBeenCalledTimes(1);
  });
});
