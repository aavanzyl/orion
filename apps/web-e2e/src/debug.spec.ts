import { expect, test } from '@playwright/test';
import { mockApi } from './mock-api.js';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test.describe('debug page', () => {
  test('loads debug page, selects a ticket, and renders log events', async ({ page }) => {
    await page.goto('/debug');

    await expect(page.getByRole('heading', { name: 'Debug Logs' })).toBeVisible();

    // The recent tickets list should show our mocked tickets
    await expect(page.getByText('Test Feature')).toBeVisible();
    await expect(page.getByText('A Bug to Fix')).toBeVisible();

    // Click a recent ticket
    await page.getByText('Test Feature').click();

    // Should show the ticket info bar
    await expect(page.getByText('T-1').first()).toBeVisible();

    // Event type badges should be visible
    await expect(page.getByText('log', { exact: true })).toBeVisible();
    await expect(page.getByText('transition', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('agent.message')).toBeVisible();

    // Payload snippets should render
    await expect(page.getByText('Starting workflow execution')).toBeVisible();
    await expect(page.getByText('Processing ticket\u2026').first()).toBeVisible();

    // Node keys in badges
    await expect(page.getByText('implement', { exact: true }).first()).toBeVisible();
  });

  test('node-key filter textbox filters log request with nodeKey query param', async ({ page }) => {
    let lastLogRequestUrl = '';
    await page.route('**/api/tickets/*/logs*', async (route) => {
      lastLogRequestUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'ev-1',
              runId: 'run-1',
              type: 'log',
              payload: { message: 'Filtered log', nodeKey: 'approval' },
              createdAt: '2024-01-01T00:00:01.000Z',
            },
          ],
          success: true,
        }),
      });
    });

    await page.goto('/debug');

    // Select a ticket first
    await page.getByText('Test Feature').click();

    // Type a node key filter
    const nodeKeyInput = page.getByPlaceholder('Filter by node key...');
    await expect(nodeKeyInput).toBeVisible();
    await nodeKeyInput.fill('approval');

    // The log request should contain nodeKey=approval in query params
    await expect(async () => {
      const url = new URL(lastLogRequestUrl);
      expect(url.searchParams.get('nodeKey')).toBe('approval');
    }).toPass();
  });
});
