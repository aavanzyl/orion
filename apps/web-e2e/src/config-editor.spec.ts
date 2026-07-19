import { expect, test } from '@playwright/test';
import { mockApi } from './mock-api.js';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test.describe('config editor page', () => {
  test('form mode renders project fields, swimlane rows, and node table', async ({ page }) => {
    await page.goto('/projects/project-1/config');

    await expect(page.getByRole('heading', { name: 'Orion configuration' })).toBeVisible();

    // Project name input
    const projectNameInput = page.locator('#cfg-project-name');
    await expect(projectNameInput).toHaveValue('Demo Project');

    // Workflow name input
    const workflowNameInput = page.locator('#cfg-workflow-name');
    await expect(workflowNameInput).toHaveValue('default');

    // Swimlane rows
    await expect(page.locator('input[value="backlog"]').first()).toBeVisible();
    await expect(page.locator('input[value="in_progress"]').first()).toBeVisible();
    await expect(page.locator('input[value="done"]').first()).toBeVisible();

    // Node table rows with type badges
    const table = page.locator('table');
    await expect(table.getByText('implement').first()).toBeVisible();
    await expect(table.getByText('approval').first()).toBeVisible();
    // Type badges
    const agentBadge = table.getByText('agent').first();
    await expect(agentBadge).toBeVisible();
    const approvalBadge = table.getByText('approval').first();
    await expect(approvalBadge).toBeVisible();
  });

  test('switches to YAML mode, edits content, and saves via PUT', async ({ page }) => {
    let putBody: Record<string, unknown> | null = null;
    await page.route('**/api/projects/*/config/raw', async (route, request) => {
      if (request.method() === 'PUT') {
        putBody = JSON.parse(request.postData() ?? '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: {}, success: true }),
        });
      } else {
        await route.fallback();
      }
    });

    await page.goto('/projects/project-1/config');

    // Switch to YAML mode
    await page.getByRole('button', { name: 'YAML' }).click();

    // Textarea should contain the YAML
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toContainText('project:');
    await expect(textarea).toContainText('Demo Project');

    // Append a shell node to the YAML
    const shellNode = '\n    - id: lint\n      type: shell\n      script: npm run lint';
    const current = await textarea.inputValue();
    await textarea.fill(current + shellNode);

    // Save
    await page.getByRole('button', { name: 'Save' }).click();

    // Assert PUT body contains the new node id
    await expect(async () => {
      expect(putBody).not.toBeNull();
      const content = String(putBody?.content ?? '');
      expect(content).toContain('lint');
    }).toPass();
  });

  test('adds a shell node via form mode dialog and saves', async ({ page }) => {
    let putBody: Record<string, unknown> | null = null;
    await page.route('**/api/projects/*/config/raw', async (route, request) => {
      if (request.method() === 'PUT') {
        putBody = JSON.parse(request.postData() ?? '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: {}, success: true }),
        });
      } else {
        await route.fallback();
      }
    });

    await page.goto('/projects/project-1/config');

    // Click "Add node"
    await page.getByRole('button', { name: 'Add node' }).click();

    // Dialog should be visible
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Add node')).toBeVisible();

    // Select "Shell — a deterministic script" type
    await dialog.getByLabel('Type').click();
    // The SelectContent renders in a portal; pick the shell option
    await page.getByRole('option', { name: 'Shell — a deterministic script' }).click();

    // Fill Id
    await dialog.getByLabel('Id').fill('lint');

    // Fill Script
    await dialog.getByLabel('Script').fill('npm run lint');

    // Click Add
    await dialog.getByRole('button', { name: 'Add' }).click();

    // Dialog should close; node should appear in table
    await expect(dialog).toBeHidden();
    const table = page.locator('table');
    await expect(table.getByText('lint').first()).toBeVisible();

    // Save
    await page.getByRole('button', { name: 'Save' }).click();

    // Assert PUT body includes the new node
    await expect(async () => {
      expect(putBody).not.toBeNull();
      const content = String(putBody?.content ?? '');
      expect(content).toContain('id: lint');
      expect(content).toContain('npm run lint');
    }).toPass({ timeout: 10000 });
  });

  test('validation: clearing project name shows warning and prevents save', async ({ page }) => {
    let putFired = false;
    await page.route('**/api/projects/*/config/raw', async (route, request) => {
      if (request.method() === 'PUT') {
        putFired = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: {}, success: true }),
        });
      } else {
        await route.fallback();
      }
    });

    await page.goto('/projects/project-1/config');

    // Clear the project name input
    const projectNameInput = page.locator('#cfg-project-name');
    await projectNameInput.fill('');

    // Validation warning should appear
    await expect(page.getByText('Resolve before saving:')).toBeVisible();
    await expect(page.getByText('Project name is required.')).toBeVisible();

    // Save button should be disabled (clicking does nothing; assert PUT never fired)
    const saveButton = page.getByRole('button', { name: 'Save' });
    await expect(saveButton).toBeDisabled();

    // Double-check no PUT was fired by toggling to YAML and back
    await page.getByRole('button', { name: 'YAML' }).click();
    await page.getByRole('button', { name: 'Form' }).click();
    // The issues should still be present after switching back
    await expect(page.getByText('Resolve before saving:')).toBeVisible();

    expect(putFired).toBe(false);
  });
});
