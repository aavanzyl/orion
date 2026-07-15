import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedProjectRepo, SAMPLE_CONFIG_YAML, type TestApp } from './app.js';

const execAsync = promisify(exec);

async function initGitRepo(dir: string): Promise<void> {
  await execAsync('git init', { cwd: dir });
  await execAsync('git config user.email "test@test.test"', { cwd: dir });
  await execAsync('git config user.name "Test"', { cwd: dir });
  await execAsync('git add -A', { cwd: dir });
  await execAsync('git commit -m "initial"', { cwd: dir });
}

const CONFIG_WITH_TRIGGER = `project:
  name: trigger-test
  defaultBranch: main
board:
  swimlanes: [backlog, investigating, review, done]
  triggerSwimlane: investigating
workflow:
  name: investigate-workflow
  nodes:
    - id: investigate
      type: agent
      provider: deepseek
      model: deepseek-v4-flash
      swimlane: investigating
`;

const CONFIG_LEGACY_COLUMNS = `project:
  name: legacy-trigger-test
  defaultBranch: main
board:
  columns: [backlog, investigating, done]
  triggerSwimlane: investigating
workflow:
  name: investigate-workflow
  nodes:
    - id: investigate
      type: agent
      provider: deepseek
      model: deepseek-v4-flash
      swimlane: investigating
`;

async function waitForRuns(
  app: TestApp['app'],
  ticketId: string,
  minCount: number,
  maxRetries = 30,
): Promise<{ body: any }> {
  for (let i = 0; i < maxRetries; i++) {
    const res = await request(app).get(`/api/tickets/${ticketId}/runs`);
    if (res.status === 200 && Array.isArray(res.body.data) && res.body.data.length >= minCount) {
      return res;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const final = await request(app).get(`/api/tickets/${ticketId}/runs`);
  throw new Error(
    `Timed out waiting for ${minCount} run(s); found ${JSON.stringify(final.body.data)}`,
  );
}

async function waitForLogs(
  app: TestApp['app'],
  ticketId: string,
  maxRetries = 30,
): Promise<{ body: any }> {
  for (let i = 0; i < maxRetries; i++) {
    const res = await request(app).get(`/api/tickets/${ticketId}/logs`);
    if (res.status === 200 && Array.isArray(res.body.data) && res.body.data.length > 0) {
      return res;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const final = await request(app).get(`/api/tickets/${ticketId}/logs`);
  throw new Error(
    `Timed out waiting for logs; found ${JSON.stringify(final.body.data)}`,
  );
}

describe('trigger flow (integration)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  describe('with triggerSwimlane configured', () => {
    let projectId: string;

    beforeAll(async () => {
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_TRIGGER);
      await initGitRepo(rootPath);
      const project = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Trigger Test', sourceKind: 'local', rootPath, config: CONFIG_WITH_TRIGGER });
      projectId = project.body.data.id;
    });

    it('creates a run when ticket moves to triggerSwimlane', async () => {
      const created = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Investigate', swimlane: 'backlog' });
      expect(created.status).toBe(201);

      const ticketId = created.body.data.id;

      const move = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      expect(move.status).toBe(200);

      const runs = await waitForRuns(ctx.app, ticketId, 1);
      expect(runs.body.data.length).toBeGreaterThan(0);

      const logs = await waitForLogs(ctx.app, ticketId);
      expect(logs.body.data.length).toBeGreaterThan(0);
    });

    it('does NOT create a run when ticket moves to non-trigger swimlane', async () => {
      const created = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Skip Trigger', swimlane: 'backlog' });
      expect(created.status).toBe(201);

      const ticketId = created.body.data.id;

      const move = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'review' });
      expect(move.status).toBe(200);

      const runs = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runs.status).toBe(200);
      expect(runs.body.data).toEqual([]);
    });

    it('does NOT create a run when ticket already has prior runs', async () => {
      const created = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Already Ran', swimlane: 'backlog' });
      expect(created.status).toBe(201);

      const ticketId = created.body.data.id;

      const start = await request(ctx.app).post(`/api/tickets/${ticketId}/run`);
      expect(start.status).toBe(201);

      const beforeMove = await waitForRuns(ctx.app, ticketId, 1);
      expect(beforeMove.body.data.length).toBe(1);

      const move = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      expect(move.status).toBe(200);

      const afterMove = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(afterMove.status).toBe(200);
      expect(afterMove.body.data.length).toBe(1);
    });
  });

  describe('without triggerSwimlane (fallback to swimlanes[0])', () => {
    let projectId: string;

    beforeAll(async () => {
      const rootPath = await seedProjectRepo();
      await initGitRepo(rootPath);
      const project = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Fallback Test', sourceKind: 'local', rootPath });
      projectId = project.body.data.id;
    });

    it('creates a run when moving to the first swimlane (backlog) but not to other swimlanes', async () => {
      const created = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Fallback Trigger', swimlane: 'backlog' });
      expect(created.status).toBe(201);

      const ticketId = created.body.data.id;

      const moveToInProgress = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'in_progress' });
      expect(moveToInProgress.status).toBe(200);

      const runsAfterInProgress = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsAfterInProgress.status).toBe(200);
      expect(runsAfterInProgress.body.data).toEqual([]);

      const moveToBacklog = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'backlog' });
      expect(moveToBacklog.status).toBe(200);

      const runsAfterBacklog = await waitForRuns(ctx.app, ticketId, 1);
      expect(runsAfterBacklog.body.data.length).toBe(1);
    });
  });

  describe('with nonexistent triggerSwimlane', () => {
    let projectId: string;

    beforeAll(async () => {
      const configYaml = CONFIG_WITH_TRIGGER.replace(
        'triggerSwimlane: investigating',
        'triggerSwimlane: nonexistent',
      );
      const rootPath = await seedProjectRepo({}, configYaml);
      const project = await request(ctx.app)
        .post('/api/projects')
        .send({
          name: 'Nonexistent Trigger',
          sourceKind: 'local',
          rootPath,
          config: configYaml,
        });
      projectId = project.body.data.id;
    });

    it('does NOT create a run when triggerSwimlane does not match any swimlane', async () => {
      const created = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'No Match', swimlane: 'backlog' });
      expect(created.status).toBe(201);

      const ticketId = created.body.data.id;

      const move = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      expect(move.status).toBe(200);

      const runs = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runs.status).toBe(200);
      expect(runs.body.data).toEqual([]);
    });
  });

  describe('with legacy columns config', () => {
    let projectId: string;

    beforeAll(async () => {
      const rootPath = await seedProjectRepo({}, CONFIG_LEGACY_COLUMNS);
      const project = await request(ctx.app)
        .post('/api/projects')
        .send({
          name: 'Legacy Columns',
          sourceKind: 'local',
          rootPath,
          config: CONFIG_LEGACY_COLUMNS,
        });
      projectId = project.body.data.id;
    });

    it('trigger works when using columns instead of swimlanes', async () => {
      const created = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Legacy Column Trigger', swimlane: 'backlog' });
      expect(created.status).toBe(201);

      const ticketId = created.body.data.id;

      const move = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      expect(move.status).toBe(200);

      const runs = await waitForRuns(ctx.app, ticketId, 1);
      expect(runs.body.data.length).toBe(1);
    });
  });

  describe('manual run via POST /tickets/:id/run', () => {
    let projectId: string;

    beforeAll(async () => {
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_TRIGGER);
      await initGitRepo(rootPath);
      const project = await request(ctx.app)
        .post('/api/projects')
        .send({
          name: 'Manual Run Test',
          sourceKind: 'local',
          rootPath,
          config: CONFIG_WITH_TRIGGER,
        });
      projectId = project.body.data.id;
    });

    it('creates a run via manual start endpoint', async () => {
      const created = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Manual Start', swimlane: 'backlog' });
      expect(created.status).toBe(201);

      const ticketId = created.body.data.id;

      const start = await request(ctx.app).post(`/api/tickets/${ticketId}/run`);
      expect(start.status).toBe(201);
      expect(start.body.success).toBe(true);

      const runs = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runs.status).toBe(200);
      expect(runs.body.data.length).toBe(1);
    });
  });
});
