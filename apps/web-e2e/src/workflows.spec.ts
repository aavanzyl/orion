import { expect, test } from '@playwright/test';
import { mockApi } from './mock-api.js';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('renders the workflow template list from the mocked API', async ({ page }) => {
  await page.goto('/workflows');

  await expect(page.getByRole('heading', { name: 'Workflow templates', level: 1 })).toBeVisible();
  await expect(
    page.getByText('Default (investigate → implement → verify → PR)'),
  ).toBeVisible();
  await expect(page.getByText('Test-driven development')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy YAML' }).first()).toBeVisible();
});
