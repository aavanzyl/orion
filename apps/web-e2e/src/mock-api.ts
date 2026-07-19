import type { Page, Route } from '@playwright/test';

/**
 * Minimal JSON matching the `{ data, success }` envelope the web `request()`
 * helper unwraps (see `apps/web/src/lib/api.ts`).
 */
function envelope<T>(data: T): string {
  return JSON.stringify({ data, success: true });
}

const PROJECT = {
  id: 'project-1',
  name: 'Demo Project',
  sourceKind: 'local',
  repoUrl: '',
  rootPath: '/tmp/demo',
  scmProvider: 'github',
  boardProvider: 'native',
  defaultBranch: 'main',
  configPath: '.orion/config.yaml',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const TEMPLATES = [
  {
    name: 'default',
    title: 'Default (investigate → implement → verify → PR)',
    description: 'The balanced starting point for most tickets.',
    tags: ['general', 'recommended'],
    nodeCount: 5,
    nodeTypes: ['agent', 'shell', 'approval', 'scm'],
  },
  {
    name: 'tdd',
    title: 'Test-driven development',
    description: 'Write failing tests first, then loop until they pass.',
    tags: ['testing'],
    nodeCount: 4,
    nodeTypes: ['agent', 'shell', 'scm'],
  },
];

const ANALYTICS = {
  successRate: 0,
  totalRuns: 0,
  totalCostUsd: 0,
  totalTokens: 0,
  runsByDay: [],
  byProject: [],
  byWorkflow: [],
};

const BOARD = {
  projectId: PROJECT.id,
  swimlanes: [
    {
      key: 'backlog',
      title: 'Backlog',
      tickets: [
        {
          id: 'ticket-1',
          projectId: PROJECT.id,
          title: 'Test Feature',
          description: 'A test ticket',
          swimlane: 'backlog',
          priority: 1,
          labelIds: [],
          source: 'native',
          order: 1,
          type: 'feature',
          displayKey: 'T-1',
          startDate: null,
          dueDate: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 'ticket-2',
          projectId: PROJECT.id,
          title: 'A Bug to Fix',
          description: 'Bug report',
          swimlane: 'backlog',
          priority: 2,
          labelIds: [],
          source: 'native',
          order: 2,
          type: 'bug',
          displayKey: 'T-2',
          startDate: null,
          dueDate: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    },
    { key: 'in_progress', title: 'In Progress', tickets: [] },
    { key: 'done', title: 'Done', tickets: [] },
  ],
};

const CODE_INDEX = {
  id: 'index-1',
  projectId: PROJECT.id,
  status: 'idle',
  provider: 'local',
  dimensions: 256,
  fileCount: 0,
  chunkCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const CONFIG = {
  board: { swimlanes: ['backlog', 'in_progress', 'done'] },
  workflow: { name: 'default', nodes: [] },
};

const RAW_CONFIG_YAML = `project:
  name: Demo Project
  defaultBranch: main
board:
  swimlanes:
    - backlog
    - in_progress
    - done
workflow:
  name: default
  nodes:
    - id: implement
      type: agent
      provider: codex
      model: gpt-5-codex
      instructions: instructions/implement.md
    - id: approval
      type: approval
      dependsOn:
        - implement
issueTypes:
  - name: feature
    label: Feature
    workflow: default
  - name: bug
    label: Bug
    workflow: default
`;

const ALL_TICKETS = [
  ...BOARD.swimlanes.flatMap((s) => s.tickets),
];

const TICKET_DETAIL = {
  ...BOARD.swimlanes[0].tickets[0],
  labels: [],
  children: [],
  relations: [],
};

const RUN: Record<string, unknown> = {
  id: 'run-1',
  ticketId: 'ticket-1',
  projectId: PROJECT.id,
  workflowName: 'default',
  status: 'running',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const RUN_NODES = [
  {
    id: 'rn-1',
    runId: 'run-1',
    nodeKey: 'approval',
    type: 'approval',
    status: 'waiting',
    dependsOn: [],
  },
];

const LOG_EVENTS = [
  {
    id: 'ev-1',
    runId: 'run-1',
    type: 'log',
    payload: { message: 'Starting workflow execution', nodeKey: 'implement' },
    createdAt: '2024-01-01T00:00:01.000Z',
  },
  {
    id: 'ev-2',
    runId: 'run-1',
    type: 'transition',
    payload: { from: 'backlog', to: 'in_progress', nodeKey: 'implement' },
    createdAt: '2024-01-01T00:00:02.000Z',
  },
  {
    id: 'ev-3',
    runId: 'run-1',
    type: 'agent.message',
    payload: { text: 'Processing ticket…', nodeKey: 'implement' },
    createdAt: '2024-01-01T00:00:03.000Z',
  },
];

/**
 * Stub every `/api/**` request the web app makes so the E2E suite runs without a
 * live orchestrator. Unknown endpoints resolve to an empty list, and SSE stream
 * requests are aborted (the app tolerates a missing stream).
 */
export async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: envelope(data) });

    if (path.endsWith('/stream')) return route.abort();

    if (path === '/projects') return json([PROJECT]);
    if (path === '/providers') return json([]);
    if (path === '/runs') return json([]);
    if (path === '/analytics') return json(ANALYTICS);
    if (path === '/workflows/templates') return json(TEMPLATES);
    if (path.startsWith('/workflows/templates/')) {
      return json({ ...TEMPLATES[0], yaml: 'workflow:\n  name: default\n', suggestedSwimlanes: [] });
    }
    if (/^\/projects\/[^/]+\/board$/.test(path)) return json(BOARD);
    if (/^\/projects\/[^/]+\/index$/.test(path)) return json(CODE_INDEX);
    if (/^\/projects\/[^/]+\/config$/.test(path)) return json(CONFIG);
    if (/^\/projects\/[^/]+\/board-connection$/.test(path)) return json({ connected: false });
    if (/^\/projects\/[^/]+\/labels$/.test(path)) return json([]);
    if (/^\/tickets\/[^/]+\/runs$/.test(path)) return json([]);
    if (/^\/projects\/[^/]+\/epics$/.test(path)) return json([]);

    // Single project fetch (used by config editor page)
    if (/^\/projects\/[^/]+$/.test(path) && route.request().method() === 'GET') return json(PROJECT);

    // Raw config (used by config editor)
    if (/^\/projects\/[^/]+\/config\/raw$/.test(path) && route.request().method() === 'GET') {
      return json({ content: RAW_CONFIG_YAML, configPath: '.orion/config.yaml' });
    }

    // All tickets (used by debug page)
    if (path === '/tickets') return json(ALL_TICKETS);

    // Ticket detail (used by ticket sheet)
    if (/^\/tickets\/[^/]+\/detail$/.test(path)) return json(TICKET_DETAIL);

    // Ticket logs (used by debug page)
    if (/^\/tickets\/[^/]+\/logs$/.test(path)) return json(LOG_EVENTS);

    // Run detail with nodes (used by approve flow)
    if (/^\/runs\/[^/]+$/.test(path) && route.request().method() === 'GET') {
      return json({ run: RUN, nodes: RUN_NODES });
    }

    // Run actions
    if (/^\/runs\/[^/]+\/cancel$/.test(path) && route.request().method() === 'POST') {
      return json({ cancelled: true });
    }
    if (/^\/runs\/[^/]+\/retry$/.test(path) && route.request().method() === 'POST') {
      return json({ ...RUN, status: 'running' });
    }
    if (/^\/runs\/[^/]+\/approve$/.test(path) && route.request().method() === 'POST') {
      return json({ ...RUN, status: 'running' });
    }

    // Move endpoint returns { ticket, trigger } shape
    if (/^\/tickets\/[^/]+\/move$/.test(path) && route.request().method() === 'POST') {
      try {
        const body = JSON.parse(route.request().postData() ?? '{}');
        const ticket = BOARD.swimlanes.flatMap((s) => s.tickets).find((t) => t.id === path.split('/')[2]);
        return json({
          ticket: ticket ? { ...ticket, swimlane: body.swimlane ?? ticket.swimlane } : null,
          trigger: { action: 'none' },
        });
      } catch {
        return json({ ticket: null, trigger: { action: 'none', reason: 'no-trigger' } });
      }
    }

    return json([]);
  });
}
