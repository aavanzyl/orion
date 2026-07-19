import { expect, test } from '@playwright/test';
import { mockApi } from './mock-api.js';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('renders the app shell with all sidebar nav items', async ({ page }) => {
  await page.goto('/');

  const nav = page.locator('aside');
  await expect(nav.getByText('Orion', { exact: true })).toBeVisible();

  for (const label of [
    'Projects',
    'Board',
    'Chat',
    'Dashboard',
    'Analytics',
    'Evaluations',
    'Workflows',
    'MCP',
    'Skills',
    'Schedule',
    'Settings',
  ]) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
});

const ROUTES: Array<{ path: string; heading: string }> = [
  { path: '/', heading: 'Board' },
  { path: '/dashboard', heading: 'Dashboard' },
  { path: '/analytics', heading: 'Analytics' },
  { path: '/chat', heading: 'Chat' },
  { path: '/projects', heading: 'Projects' },
  { path: '/workflows', heading: 'Workflow templates' },
  { path: '/schedule', heading: 'Schedule' },
  { path: '/codebase', heading: 'Codebase' },
  { path: '/settings', heading: 'Settings' },
  { path: '/mcp', heading: 'MCP' },
];

for (const { path, heading } of ROUTES) {
  test(`navigates to ${path} and renders its heading`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1, exact: true })).toBeVisible();
  });
}
