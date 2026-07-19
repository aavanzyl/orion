import { describe, expect, it, vi } from 'vitest';
import type {
  BoardRegistry,
  RemoteBoardClient,
  RemoteBoardClientFactory,
  RemoteConnectionConfig,
} from '@orion/board-core';
import type {
  BoardConnectionRepository,
  EpicRepository,
  LabelRepository,
  ProjectRepository,
  TicketRepository,
} from '@orion/db';
import type { RunEventBus } from '../event-bus.js';
import { BoardSyncService, type SecretCipherLike } from './board-sync.service.js';

interface FakeState {
  issueState?: Record<string, string>;
  comments?: { issueId: string; body: string }[];
}

function fakeIssues(overrides?: Record<string, Record<string, unknown>>) {
  return [
    {
      id: 'issue-1',
      identifier: 'TST-1',
      title: 'Setup CI',
      description: 'Configure CI',
      stateId: 'state-todo',
      stateName: 'Todo',
      url: 'https://linear.app/issue/TST-1',
      priority: 2,
      dueDate: '2026-09-01',
      startedAt: '2026-07-15T12:00:00.000Z',
      labels: [{ name: 'frontend', color: '#ff0000' }],
      epic: { id: 'proj-1', name: 'Platform', color: '#7c3aed' },
      ...(overrides?.['issue-1'] ?? {}),
    },
    {
      id: 'issue-2',
      identifier: 'TST-2',
      title: 'Add tests',
      description: 'Write tests',
      stateId: 'state-in-progress',
      stateName: 'In Progress',
      url: 'https://linear.app/issue/TST-2',
      priority: 1,
      ...(overrides?.['issue-2'] ?? {}),
    },
  ];
}

function fakeClient(states?: FakeState, issuesOverride?: Parameters<typeof fakeIssues>[0]): RemoteBoardClient {
  return {
    listContainers: vi.fn().mockResolvedValue([
      { id: 'team-1', name: 'Engineering', key: 'ENG' },
    ]),
    listStates: vi.fn().mockResolvedValue([
      { id: 'state-todo', name: 'Todo', type: 'unstarted' },
      { id: 'state-in-progress', name: 'In Progress', type: 'started' },
      { id: 'state-done', name: 'Done', type: 'completed' },
    ]),
    listIssues: vi.fn().mockResolvedValue(fakeIssues(issuesOverride)),
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
      insertSyncLog: vi.fn(),
      getLatestSyncLog: vi.fn(),
      getSyncLogs: vi.fn(),
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
    labels: {
      getByName: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async (input: { name: string; color?: string }) => ({
        id: `label-${input.name}`,
        projectId: 'p1',
        name: input.name,
        color: input.color ?? '#6366f1',
        createdAt: new Date().toISOString(),
      })),
    } as unknown as LabelRepository,
    epics: {
      getByExternal: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async (input: { title: string; externalId?: string }) => ({
        id: `epic-${input.title}`,
        projectId: 'p1',
        title: input.title,
        description: '',
        color: '#7c3aed',
        externalId: input.externalId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    } as unknown as EpicRepository,
    boards: {
      get: vi.fn(),
    } as unknown as BoardRegistry,
  };
}

function mockBus(): RunEventBus {
  return {
    publish: vi.fn(),
    subscribe: vi.fn().mockReturnValue(vi.fn()),
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(vi.fn()),
  } as unknown as RunEventBus;
}

function service(
  repos: ReturnType<typeof mockRepos>,
  client: RemoteBoardClient,
  cipher?: SecretCipherLike,
  bus?: RunEventBus,
) {
  return new BoardSyncService(
    repos.boardConnections,
    repos.tickets,
    repos.projects,
    repos.labels,
    repos.epics,
    repos.boards,
    bus ?? mockBus(),
    cipher,
    factories(client),
  );
}

const baseConn = {
  id: 'conn-1',
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
  syncIntervalMs: undefined as number | undefined,
  lastSyncedAt: undefined as string | undefined,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
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
    expect(result).toEqual({ imported: 0, updated: 0, epicsLinked: 0 });
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
      encrypt: (s: string) => `enc:${s}`,
      decrypt: (s: string) => s.replace(/^enc:/, ''),
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
      repos.labels,
      repos.epics,
      repos.boards,
      mockBus(),
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
      repos.labels,
      repos.epics,
      repos.boards,
      mockBus(),
      undefined,
      { linear: () => fakeClient() },
    );
    await expect(svc.syncNow('p1')).rejects.toThrow(/Unsupported board provider/);
  });

  // --- triggerOnImport removed: imports NEVER trigger workflows ---

  it('imports never call onSwimlaneEnter regardless of prior triggerOnImport setting', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      stateMap: { investigating: 'state-todo' },
    });
    (repos.projects.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'p1',
      name: 'Test',
      boardProvider: 'native',
    });
    (repos.boards.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getBoard: vi.fn().mockResolvedValue({
        projectId: 'p1',
        swimlanes: [{ key: 'investigating', title: 'Investigating', tickets: [] }],
      }),
    });
    (repos.tickets.getByExternal as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (repos.tickets.create as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { title: string }) => ({ id: 'new-' + input.title, ...input }),
    );

    const svc = service(repos, fakeClient());
    const enteredSpy = vi.fn().mockResolvedValue(undefined);
    svc.setOnTicketEnteredSwimlane(enteredSpy);

    const result = await svc.syncNow('p1');
    expect(result.imported).toBeGreaterThanOrEqual(1);
    expect(enteredSpy).not.toHaveBeenCalled();
  });

  it('always calls onSwimlaneEnter for existing tickets with swimlane change', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      stateMap: { in_progress: 'state-todo' },
    });
    (repos.projects.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'p1',
      name: 'Test',
      boardProvider: 'native',
    });
    (repos.boards.get as ReturnType<typeof vi.fn>).mockReturnValue({
      getBoard: vi.fn().mockResolvedValue({
        projectId: 'p1',
        swimlanes: [{ key: 'in_progress', title: 'In Progress', tickets: [] }],
      }),
    });
    (repos.tickets.getByExternal as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'existing-ticket',
      title: 'Old title',
      description: 'Old desc',
      swimlane: 'backlog',
      priority: 0,
      labelIds: [],
    });
    (repos.tickets.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const svc = service(repos, fakeClient());
    const enteredSpy = vi.fn().mockResolvedValue(undefined);
    svc.setOnTicketEnteredSwimlane(enteredSpy);

    const result = await svc.syncNow('p1');
    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(enteredSpy).toHaveBeenCalledWith('existing-ticket', 'in_progress');
  });

  // --- enriched sync: priority, dates, labels, epic ---

  it('sets priority, dates, labels, and epic on imported tickets', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      stateMap: { backlog: 'state-todo' },
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
    (repos.tickets.create as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: Record<string, unknown>) => ({ id: 'new-ticket', ...input }),
    );
    const bus = mockBus();

    const svc = service(repos, fakeClient(), undefined, bus);
    const result = await svc.syncNow('p1');

    expect(result.imported).toBeGreaterThanOrEqual(1);
    expect(repos.tickets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: 2,
        dueDate: '2026-09-01',
        startDate: '2026-07-15',
      }),
    );
    expect(result.epicsLinked).toBeGreaterThanOrEqual(1);
  });

  it('creates labels from remote labels when syncing new tickets', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      stateMap: { backlog: 'state-todo' },
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
    (repos.tickets.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const svc = service(repos, fakeClient());
    await svc.syncNow('p1');

    expect(repos.labels.getByName).toHaveBeenCalled();
    expect(repos.labels.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'frontend', color: '#ff0000' }),
    );
  });

  it('reuses existing label when name matches case-insensitively', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      stateMap: { backlog: 'state-todo' },
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
    (repos.tickets.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (repos.labels.getByName as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'label-frontend',
      name: 'Frontend',
      color: '#ff0000',
    });
    (repos.labels.create as ReturnType<typeof vi.fn>).mockClear();

    const svc = service(repos, fakeClient());
    await svc.syncNow('p1');

    expect(repos.labels.create).not.toHaveBeenCalled();
  });

  it('creates epic from remote Linear project when syncing new tickets', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      stateMap: { backlog: 'state-todo' },
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
    (repos.tickets.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const svc = service(repos, fakeClient());
    const result = await svc.syncNow('p1');

    expect(repos.epics.getByExternal).toHaveBeenCalledWith('p1', 'proj-1');
    expect(repos.epics.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Platform', externalId: 'proj-1' }),
    );
    expect(result.epicsLinked).toBeGreaterThanOrEqual(1);
  });

  it('reuses existing epic by externalId', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      stateMap: { backlog: 'state-todo' },
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
    (repos.tickets.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (repos.epics.getByExternal as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'existing-epic',
      projectId: 'p1',
      title: 'Platform',
      description: '',
      color: '#7c3aed',
      externalId: 'proj-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    (repos.epics.create as ReturnType<typeof vi.fn>).mockClear();

    const svc = service(repos, fakeClient());
    const result = await svc.syncNow('p1');

    expect(repos.epics.create).not.toHaveBeenCalled();
    expect(result.epicsLinked).toBe(1);
  });

  it('reconciles changed priority and labels on existing tickets', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      stateMap: { backlog: 'state-todo' },
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
    (repos.tickets.getByExternal as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'existing',
      title: 'Setup CI',   // same title, no update needed
      description: 'Configure CI', // same desc
      swimlane: 'backlog',
      priority: 0,         // different from remote's 2
      labelIds: [],
      dueDate: undefined,
      startDate: undefined,
      epicId: undefined,
    });
    (repos.tickets.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const svc = service(repos, fakeClient());
    const result = await svc.syncNow('p1');

    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(repos.tickets.update).toHaveBeenCalledWith(
      'existing',
      expect.objectContaining({ priority: 2 }),
    );
  });

  it('writes sync log on success and emits sync.completed event', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      stateMap: { backlog: 'state-todo' },
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
    (repos.tickets.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const bus = mockBus();

    const svc = service(repos, fakeClient(), undefined, bus);
    const result = await svc.syncNow('p1', 'manual');

    expect(repos.boardConnections.insertSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        status: 'completed',
        imported: result.imported,
        updated: result.updated,
        trigger: 'manual',
      }),
    );
    expect(bus.emit).toHaveBeenCalledWith(
      `board:p1`,
      expect.objectContaining({ type: 'sync.completed' }),
    );
  });

  it('writes a failed sync log and emits sync.failed when the sync throws', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      stateMap: { backlog: 'state-todo' },
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
    (repos.tickets.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db exploded'));
    const bus = mockBus();

    const svc = service(repos, fakeClient(), undefined, bus);
    await expect(svc.syncNow('p1', 'manual')).rejects.toThrow('db exploded');

    expect(repos.boardConnections.insertSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        status: 'failed',
        error: 'db exploded',
        trigger: 'manual',
      }),
    );
    expect(bus.emit).toHaveBeenCalledWith(
      `board:p1`,
      expect.objectContaining({ type: 'sync.failed', error: 'db exploded' }),
    );
  });

  it('returns epicsLinked in the summary', async () => {
    const repos = mockRepos();
    (repos.boardConnections.getByProject as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseConn,
      stateMap: { backlog: 'state-todo' },
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
    (repos.tickets.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const svc = service(repos, fakeClient());
    const result = await svc.syncNow('p1');

    expect(result.epicsLinked).toBeGreaterThanOrEqual(1);
  });

  it('unused config reference stays typed', () => {
    // Type-only guard so RemoteConnectionConfig import is exercised.
    const cfg: RemoteConnectionConfig = { provider: 'linear', apiKey: 'k', containerId: 't', config: {} };
    expect(cfg.provider).toBe('linear');
  });
});
