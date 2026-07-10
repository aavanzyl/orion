import { describe, expect, it, vi } from 'vitest';
import type {
  RemoteBoardClient,
  RemoteBoardClientFactory,
  RemoteConnectionConfig,
} from '@orion/board-core';
import type { BoardRegistry } from '@orion/board-core';
import type { BoardConnectionRepository, ProjectRepository, TicketRepository } from '@orion/db';
import { BoardSyncService, type SecretCipherLike } from './board-sync.service.js';

interface FakeState {
  issueState?: Record<string, string>;
  comments?: { issueId: string; body: string }[];
}

function fakeClient(states?: FakeState): RemoteBoardClient {
  return {
    listContainers: vi.fn().mockResolvedValue([
      { id: 'team-1', name: 'Engineering', key: 'ENG' },
    ]),
    listStates: vi.fn().mockResolvedValue([
      { id: 'state-todo', name: 'Todo', type: 'unstarted' },
      { id: 'state-in-progress', name: 'In Progress', type: 'started' },
      { id: 'state-done', name: 'Done', type: 'completed' },
    ]),
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
    updateIssueState: vi.fn().mockImplementation(async (issueId: string, stateId: string) => {
      if (states) states.issueState = { ...states.issueState, [issueId]: stateId };
    }),
    createComment: vi.fn().mockImplementation(async (issueId: string, body: string) => {
      if (states) states.comments = [...(states.comments ?? []), { issueId, body }];
    }),
  };
}

function factories(client: RemoteBoardClient): Record<string, RemoteBoardClientFactory> {
  const factory: RemoteBoardClientFactory = () => client;
  return { linear: factory, jira: factory, trello: factory };
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

function service(
  repos: ReturnType<typeof mockRepos>,
  client: RemoteBoardClient,
  cipher?: SecretCipherLike,
) {
  return new BoardSyncService(
    repos.boardConnections,
    repos.tickets,
    repos.projects,
    repos.boards,
    cipher,
    factories(client),
  );
}

const baseConn = {
  projectId: 'p1',
  provider: 'linear',
  apiKey: 'key',
  teamId: 'team-1',
  config: {},
  enabled: true,
  direction: 'both' as const,
  autoPush: true,
  importNew: true,
  updateExisting: true,
  stateMap: {} as Record<string, string>,
};

describe('BoardSyncService', () => {
  it('pushTicketState no-ops when ticket is native', async () => {
    const repos = mockRepos();
    (repos.tickets.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      source: 'native',
      externalId: null,
      swimlane: 'todo',
    });
    const svc = service(repos, fakeClient());
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
      swimlane: 'todo',
    });
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const svc = service(repos, fakeClient());
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
      ...baseConn,
      stateMap: { in_progress: 'state-in-progress' },
    });
    const states: FakeState = {};
    const svc = service(repos, fakeClient(states));
    await svc.pushTicketState('t1');
    expect(states.issueState?.['issue-1']).toBe('state-in-progress');
  });

  it('pushTicketState no-ops when direction is pull-only', async () => {
    const repos = mockRepos();
    (repos.tickets.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      source: 'linear',
      externalId: 'issue-1',
      swimlane: 'in_progress',
    });
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      direction: 'pull',
      stateMap: { in_progress: 'state-in-progress' },
    });
    const states: FakeState = {};
    const svc = service(repos, fakeClient(states));
    await svc.pushTicketState('t1');
    expect(states.issueState).toBeUndefined();
  });

  it('pushTicketState no-ops when autoPush is disabled', async () => {
    const repos = mockRepos();
    (repos.tickets.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      source: 'linear',
      externalId: 'issue-1',
      swimlane: 'in_progress',
    });
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      autoPush: false,
      stateMap: { in_progress: 'state-in-progress' },
    });
    const states: FakeState = {};
    const svc = service(repos, fakeClient(states));
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
    const svc = service(repos, client);
    const result = await svc.postComment('t1', 'hello');
    expect(result).toEqual({ posted: false });
    expect(client.createComment).not.toHaveBeenCalled();
    expect(repos.boardConnections.getByProject).not.toHaveBeenCalled();
  });

  it('postComment posts to the remote when a connection is active', async () => {
    const repos = mockRepos();
    (repos.tickets.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      source: 'linear',
      externalId: 'issue-1',
    });
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
    });
    const client = fakeClient();
    const svc = service(repos, client);
    const result = await svc.postComment('t1', 'hello');
    expect(client.createComment).toHaveBeenCalledWith('issue-1', 'hello');
    expect(result).toEqual({ posted: true, target: 'linear:issue-1' });
  });

  it('syncNow creates new tickets from remote issues', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      stateMap: { backlog: 'state-todo' },
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
      async (input: { title: string }) => ({ id: 'new-' + input.title, ...input }),
    );

    const svc = service(repos, fakeClient());
    const result = await svc.syncNow('p1');

    expect(result.imported).toBeGreaterThanOrEqual(1);
    expect(repos.tickets.create).toHaveBeenCalled();
    expect(repos.boardConnections.touchSynced).toHaveBeenCalled();
  });

  it('syncNow maps issues by inverted stateMap', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      stateMap: { in_progress: 'state-todo' },
    });
    (repos.projects.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'p1',
      boardProvider: 'native',
    });
    (repos.boards.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getBoard: vi.fn().mockResolvedValue({
        projectId: 'p1',
        swimlanes: [{ key: 'in_progress', title: 'In Progress', tickets: [] }],
      }),
    });
    (repos.tickets.getByExternal as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (repos.tickets.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const svc = service(repos, fakeClient());
    await svc.syncNow('p1');

    // issue-1 sits in state-todo, mapped to swimlane in_progress.
    expect(repos.tickets.create).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'issue-1', swimlane: 'in_progress', source: 'linear' }),
    );
  });

  it('syncNow skips creation when importNew is false', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      importNew: false,
    });
    (repos.projects.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'p1',
      boardProvider: 'native',
    });
    (repos.boards.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getBoard: vi.fn().mockResolvedValue({
        projectId: 'p1',
        swimlanes: [{ key: 'backlog', title: 'Backlog', tickets: [] }],
      }),
    });
    (repos.tickets.getByExternal as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const svc = service(repos, fakeClient());
    const result = await svc.syncNow('p1');
    expect(result.imported).toBe(0);
    expect(repos.tickets.create).not.toHaveBeenCalled();
  });

  it('syncNow is a no-op for push-only connections', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      direction: 'push',
    });
    const svc = service(repos, fakeClient());
    const result = await svc.syncNow('p1');
    expect(result).toEqual({ imported: 0, updated: 0 });
    expect(repos.tickets.create).not.toHaveBeenCalled();
    expect(repos.boardConnections.touchSynced).toHaveBeenCalled();
  });

  it('upsertConnection validates with plaintext then stores the encrypted secret', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (repos.boardConnections.upsert as ReturnType<typeof vi.fn>).mockImplementation(
      async (_p: string, input: { apiKey?: string }) => ({ ...baseConn, ...input }),
    );
    const client = fakeClient();
    const cipher: SecretCipherLike = {
      encrypt: (s) => `enc:${s}`,
      decrypt: (s) => s.replace(/^enc:/, ''),
    };
    const svc = service(repos, client, cipher);

    await svc.upsertConnection('p1', { provider: 'linear', apiKey: 'secret', teamId: 'team-1' });

    expect(client.listContainers).toHaveBeenCalled();
    const stored = (repos.boardConnections.upsert as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(stored.apiKey).toBe('enc:secret');
  });

  it('routes to the provider factory named by the connection', async () => {
    const repos = mockRepos();
    (repos.tickets.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      source: 'jira',
      externalId: 'JIRA-1',
      swimlane: 'done',
    });
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      provider: 'jira',
      stateMap: { done: 'state-done' },
    });
    const jiraClient = fakeClient();
    const linearClient = fakeClient();
    const svc = new BoardSyncService(
      repos.boardConnections,
      repos.tickets,
      repos.projects,
      repos.boards,
      undefined,
      { linear: () => linearClient, jira: () => jiraClient, trello: () => jiraClient },
    );
    await svc.pushTicketState('t1');
    expect(jiraClient.updateIssueState).toHaveBeenCalledWith('JIRA-1', 'state-done');
    expect(linearClient.updateIssueState).not.toHaveBeenCalled();
  });

  it('throws for an unknown provider', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      provider: 'asana',
    });
    (repos.projects.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'p1',
      boardProvider: 'native',
    });
    const svc = new BoardSyncService(
      repos.boardConnections,
      repos.tickets,
      repos.projects,
      repos.boards,
      undefined,
      { linear: () => fakeClient() },
    );
    await expect(svc.syncNow('p1')).rejects.toThrow(/Unsupported board provider/);
  });

  it('unused config reference stays typed', () => {
    // Type-only guard so RemoteConnectionConfig import is exercised.
    const cfg: RemoteConnectionConfig = { provider: 'linear', apiKey: 'k', containerId: 't', config: {} };
    expect(cfg.provider).toBe('linear');
  });
});
