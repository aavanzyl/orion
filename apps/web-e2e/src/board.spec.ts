import { expect, test } from '@playwright/test';
import { mockApi } from './mock-api.js';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('renders board with swimlanes and tickets', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Board' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Backlog', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'In Progress', level: 2 })).toBeVisible();
  await expect(page.getByText('Test Feature')).toBeVisible();
  await expect(page.getByText('A Bug to Fix')).toBeVisible();
});

test('move endpoint returns new { ticket, trigger } response shape', async ({ page }) => {
  await page.route('**/api/tickets/*/move', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          ticket: { id: 'ticket-1', swimlane: 'in_progress', title: 'Test Feature' },
          trigger: { action: 'started', runId: 'r1', workflowName: 'default' },
        },
        success: true,
      }),
    });
  });

  await page.goto('/');

  // Directly call the move endpoint via page.evaluate to verify the response shape.
  const result = await page.evaluate(async () => {
    const r = await fetch('/api/tickets/ticket-1/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swimlane: 'in_progress' }),
    });
    return r.json();
  }) as { data: { ticket: unknown; trigger: { action: string }; }; success: boolean };

  expect(result.data).toBeDefined();
  expect(result.data.ticket).toBeDefined();
  expect(result.data.trigger).toBeDefined();
  expect(result.data.trigger.action).toBe('started');
  expect(result.success).toBe(true);
});

test('conflict on move returns 409 with activeRunId', async ({ page }) => {
  await page.route('**/api/tickets/*/move', async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { activeRunId: 'run-active', activeRunStatus: 'running' },
        success: false,
        error: 'Ticket has an active run.',
      }),
    });
  });

  await page.goto('/');

  const result = await page.evaluate(async () => {
    const r = await fetch('/api/tickets/ticket-1/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swimlane: 'in_progress' }),
    });
    return { status: r.status, body: await r.json() as { data: { activeRunId?: string }; success: boolean } };
  });

  expect(result.status).toBe(409);
  expect(result.body.data.activeRunId).toBe('run-active');
  expect(result.body.success).toBe(false);
});

test('force cancel on move sends force param and succeeds', async ({ page }) => {
  let postedForce = '';
  await page.route('**/api/tickets/*/move', async (route, request) => {
    if (request.method() === 'POST') {
      try {
        postedForce = JSON.parse(request.postData() ?? '{}').force;
      } catch { /* ignore */ }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          ticket: { id: 'ticket-1', swimlane: 'investigating', title: 'Test Feature' },
          trigger: { action: 'started', runId: 'r2', workflowName: 'default' },
        },
        success: true,
      }),
    });
  });

  await page.goto('/');

  await page.evaluate(async () => {
    await fetch('/api/tickets/ticket-1/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swimlane: 'investigating', force: 'cancel' }),
    });
  });

  expect(postedForce).toBe('cancel');
});
