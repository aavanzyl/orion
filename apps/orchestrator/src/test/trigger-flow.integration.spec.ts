import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedProjectRepo, type TestApp } from './app.js';

const execAsync = promisify(exec);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initGitRepo(dir: string): Promise<void> {
  await execAsync('git init', { cwd: dir });
  await execAsync('git config user.email "test@test.test"', { cwd: dir });
  await execAsync('git config user.name "Test"', { cwd: dir });
  await execAsync('git add -A', { cwd: dir });
  await execAsync('git commit -m "initial"', { cwd: dir });
}

const CONFIG_WITH_START_SWIMLANE = `project:
  name: trigger-test
  defaultBranch: main
board:
  swimlanes: [backlog, investigating, review, done]
workflow:
  name: investigate-workflow
  nodes:
    - id: investigate
      type: agent
      provider: deepseek
      model: deepseek-v4-flash
      swimlane: investigating
    - id: check
      type: approval
      dependsOn: [investigate]
      swimlane: review
`;

const CONFIG_NO_NODE_SWIMLANES = `project:
  name: no-node-swimlanes
  defaultBranch: main
board:
  swimlanes: [backlog, investigating, done]
workflow:
  name: investigate-workflow
  nodes:
    - id: investigate
      type: agent
      provider: deepseek
      model: deepseek-v4-flash
`;

const CONFIG_LEGACY_COLUMNS = `project:
  name: legacy-trigger-test
  defaultBranch: main
board:
  columns: [backlog, investigating, done]
workflow:
  name: investigate-workflow
  nodes:
    - id: investigate
      type: agent
      provider: deepseek
      model: deepseek-v4-flash
      column: investigating
`;

const CONFIG_ISSUE_TYPES = `project:
  name: issue-type-trigger
  defaultBranch: main
board:
  swimlanes: [backlog, investigating, building, done]
issueTypes:
  - name: bug
    label: Bug
    workflow: bug-fix
  - name: feature
    label: Feature
    workflow: feature-flow
workflows:
  bug-fix:
    name: bug-fix
    nodes:
      - id: fix
        type: shell
        script: 'echo fix'
        swimlane: investigating
  feature-flow:
    name: feature-flow
    nodes:
      - id: build
        type: shell
        script: 'echo build'
        swimlane: building
workflow:
  name: default
  nodes:
    - id: implement
      type: shell
      script: 'echo implement'
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

  describe('with a start node bound to a swimlane', () => {
    let projectId: string;

    beforeAll(async () => {
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_START_SWIMLANE);
      await initGitRepo(rootPath);
      const project = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Trigger Test', sourceKind: 'local', rootPath, config: CONFIG_WITH_START_SWIMLANE });
      projectId = project.body.data.id;
    });

    it('creates a run when ticket moves into the start node swimlane', async () => {
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

    it('does NOT create a run when ticket moves into a swimlane bound to a dependent node', async () => {
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

    it('does NOT create a run when ticket moves into a swimlane with no associated node', async () => {
      const created = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'No Node Lane', swimlane: 'backlog' });
      expect(created.status).toBe(201);

      const ticketId = created.body.data.id;

      const move = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'done' });
      expect(move.status).toBe(200);

      const runs = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runs.status).toBe(200);
      expect(runs.body.data).toEqual([]);
    });

    it('allows move-to-trigger-lane after prior run completes, creating a new run', async () => {
      const created = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Already Ran', swimlane: 'backlog' });
      expect(created.status).toBe(201);

      const ticketId = created.body.data.id;

      const start = await request(ctx.app).post(`/api/tickets/${ticketId}/run`);
      expect(start.status).toBe(201);

      const beforeMove = await waitForRuns(ctx.app, ticketId, 1);
      expect(beforeMove.body.data.length).toBe(1);

      // Cancel the run so it's terminal before the move.
      await request(ctx.app).post(`/api/runs/${start.body.data.id}/cancel`);
      await sleep(500);

      const move = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      expect(move.status).toBe(200);

      const afterMove = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(afterMove.status).toBe(200);
      // Terminal history does not block; a new run is created on trigger-lane entry.
      expect(afterMove.body.data.length).toBe(2);
    });
  });

  describe('without any node swimlane associations', () => {
    let projectId: string;

    beforeAll(async () => {
      const rootPath = await seedProjectRepo({}, CONFIG_NO_NODE_SWIMLANES);
      await initGitRepo(rootPath);
      const project = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'No Swimlane Nodes', sourceKind: 'local', rootPath, config: CONFIG_NO_NODE_SWIMLANES });
      projectId = project.body.data.id;
    });

    it('never auto-creates a run on any move', async () => {
      const created = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Never Trigger', swimlane: 'backlog' });
      expect(created.status).toBe(201);

      const ticketId = created.body.data.id;

      for (const swimlane of ['investigating', 'done', 'backlog']) {
        const move = await request(ctx.app)
          .post(`/api/tickets/${ticketId}/move`)
          .send({ swimlane });
        expect(move.status).toBe(200);
      }

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

    it('trigger works when using columns/column instead of swimlanes/swimlane', async () => {
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

  describe('with issue-type workflow routing', () => {
    let projectId: string;

    beforeAll(async () => {
      const rootPath = await seedProjectRepo({}, CONFIG_ISSUE_TYPES);
      const project = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Issue Type Trigger', sourceKind: 'local', rootPath, config: CONFIG_ISSUE_TYPES });
      projectId = project.body.data.id;
    });

    it('starts the ticket type workflow when moved into its start node swimlane', async () => {
      const created = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'A bug', type: 'bug', swimlane: 'backlog' });
      expect(created.status).toBe(201);

      const ticketId = created.body.data.id;

      const move = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      expect(move.status).toBe(200);

      const runs = await waitForRuns(ctx.app, ticketId, 1);
      expect(runs.body.data.length).toBe(1);
      expect(runs.body.data[0].workflowName).toBe('bug-fix');
    });

    it("does NOT trigger when moved into another workflow's start swimlane", async () => {
      const created = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'A feature', type: 'feature', swimlane: 'backlog' });
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

    it('starts the feature workflow when moved into its own start swimlane', async () => {
      const created = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Another feature', type: 'feature', swimlane: 'backlog' });
      expect(created.status).toBe(201);

      const ticketId = created.body.data.id;

      const move = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'building' });
      expect(move.status).toBe(200);

      const runs = await waitForRuns(ctx.app, ticketId, 1);
      expect(runs.body.data.length).toBe(1);
      expect(runs.body.data[0].workflowName).toBe('feature-flow');
    });
  });

  describe('manual run via POST /tickets/:id/run', () => {
    let projectId: string;

    beforeAll(async () => {
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_START_SWIMLANE);
      await initGitRepo(rootPath);
      const project = await request(ctx.app)
        .post('/api/projects')
        .send({
          name: 'Manual Run Test',
          sourceKind: 'local',
          rootPath,
          config: CONFIG_WITH_START_SWIMLANE,
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
