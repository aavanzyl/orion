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
    { key: 'backlog', title: 'Backlog', tickets: [] },
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

    return json([]);
  });
}
