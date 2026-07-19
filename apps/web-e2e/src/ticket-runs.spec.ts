import { expect, test } from '@playwright/test';
import { mockApi } from './mock-api.js';

const RUN_BASE = {
  id: 'run-1',
  ticketId: 'ticket-1',
  projectId: 'project-1',
  workflowName: 'default',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test.describe('ticket sheet run actions', () => {
  test('running run shows Cancel button and cancels on click', async ({ page }) => {
    let cancelCalled = false;
    await page.route('**/api/runs/*/cancel', async (route) => {
      cancelCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { cancelled: true }, success: true }),
      });
    });

    // Override runs to return a running run
    await page.route('**/api/tickets/*/runs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ ...RUN_BASE, status: 'running' }],
          success: true,
        }),
      });
    });

    await page.goto('/');

    // Click the ticket to open the sheet
    await page.getByText('Test Feature').click();

    // Wait for the sheet to render the run
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();

    // Should show the running run with Cancel button
    await expect(sheet.getByText('running')).toBeVisible();
    const cancelButton = sheet.getByRole('button', { name: 'Cancel' });
    await expect(cancelButton).toBeVisible();

    // Click Cancel
    await cancelButton.click();

    await expect(async () => {
      expect(cancelCalled).toBe(true);
    }).toPass();
  });

  test('failed run shows Retry button and retries on click', async ({ page }) => {
    let retryCalled = false;
    await page.route('**/api/runs/*/retry', async (route) => {
      retryCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { ...RUN_BASE, status: 'running' },
          success: true,
        }),
      });
    });

    await page.route('**/api/tickets/*/runs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ ...RUN_BASE, status: 'failed' }],
          success: true,
        }),
      });
    });

    await page.goto('/');
    await page.getByText('Test Feature').click();

    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('failed')).toBeVisible();

    const retryButton = sheet.getByRole('button', { name: 'Retry' });
    await expect(retryButton).toBeVisible();

    await retryButton.click();

    await expect(async () => {
      expect(retryCalled).toBe(true);
    }).toPass();
  });

  test('waiting run shows Approve and Cancel buttons; approve calls POST with nodeKey', async ({ page }) => {
    let approveBody: Record<string, unknown> | null = null;
    await page.route('**/api/runs/*/approve', async (route) => {
      approveBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { ...RUN_BASE, status: 'running' },
          success: true,
        }),
      });
    });

    // Mock getRun to return a waiting node
    await page.route('**/api/runs/run-1', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              run: { ...RUN_BASE, status: 'waiting' },
              nodes: [
                {
                  id: 'rn-1',
                  runId: 'run-1',
                  nodeKey: 'approval',
                  type: 'approval',
                  status: 'waiting',
                  dependsOn: [],
                },
              ],
            },
            success: true,
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.route('**/api/tickets/*/runs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ ...RUN_BASE, status: 'waiting' }],
          success: true,
        }),
      });
    });

    await page.goto('/');
    await page.getByText('Test Feature').click();

    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('waiting')).toBeVisible();

    // Both Approve and Cancel should be visible
    const approveButton = sheet.getByRole('button', { name: 'Approve' });
    const cancelButton = sheet.getByRole('button', { name: 'Cancel' });
    await expect(approveButton).toBeVisible();
    await expect(cancelButton).toBeVisible();

    await approveButton.click();

    await expect(async () => {
      expect(approveBody).not.toBeNull();
      expect(approveBody?.nodeKey).toBe('approval');
    }).toPass();
  });
});
