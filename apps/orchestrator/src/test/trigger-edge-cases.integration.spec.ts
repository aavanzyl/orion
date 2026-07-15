import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedProjectRepo, SAMPLE_CONFIG_YAML, type TestApp } from './app.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CONFIG_WITH_TRIGGER = `project:
  name: config-test
  defaultBranch: main
board:
  swimlanes: [backlog, investigating, done]
  triggerSwimlane: investigating
workflow:
  name: default
  nodes:
    - id: test
      type: shell
      script: 'echo test'
`;

const CONFIG_MINIMAL = `project:
  name: minimal
  defaultBranch: main
board:
  swimlanes: [todo]
workflow:
  name: default
  nodes:
    - id: step
      type: shell
      script: 'echo ok'
`;

const CONFIG_NO_TRIGGER_DIFFERENT_SWIMLANES = `project:
  name: no-trigger
  defaultBranch: main
board:
  swimlanes: [backlog, in_progress, done]
workflow:
  name: default
  nodes:
    - id: build
      type: shell
      script: 'echo build'
`;

describe('trigger edge cases (integration)', () => {
  describe('PATCH ticket swimlane change does NOT trigger a run', () => {
    let ctx: TestApp;
    let projectId: string;
    let ticketId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo();
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Patch Test', sourceKind: 'local', rootPath });
      projectId = created.body.data.id;

      const ticket = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Patch ticket', swimlane: 'backlog' });
      ticketId = ticket.body.data.id;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('PATCH to change swimlane does NOT create a run (documented gap)', async () => {
      const patchRes = await request(ctx.app)
        .patch(`/api/tickets/${ticketId}`)
        .send({ swimlane: 'backlog' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.swimlane).toBe('backlog');

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.status).toBe(200);
      expect(runsRes.body.data).toHaveLength(0);
    });
  });

  describe('config round-trip preserves triggerSwimlane', () => {
    let ctx: TestApp;
    let projectId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_TRIGGER);
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Config Roundtrip', sourceKind: 'local', rootPath, config: CONFIG_WITH_TRIGGER });
      projectId = created.body.data.id;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('GET /config returns triggerSwimlane in board', async () => {
      const res = await request(ctx.app).get(`/api/projects/${projectId}/config`);
      expect(res.status).toBe(200);
      expect(res.body.data.board.swimlanes).toEqual(['backlog', 'investigating', 'done']);
      expect(res.body.data.board.triggerSwimlane).toBe('investigating');
    });

    it('GET /config/raw includes triggerSwimlane in YAML', async () => {
      const res = await request(ctx.app).get(`/api/projects/${projectId}/config/raw`);
      expect(res.status).toBe(200);
      expect(res.body.data.content).toContain('triggerSwimlane: investigating');
    });
  });

  describe('triggerSwimlane is included in config endpoint response', () => {
    let ctx: TestApp;
    let projectId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_TRIGGER);
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Trigger Config', sourceKind: 'local', rootPath, config: CONFIG_WITH_TRIGGER });
      projectId = created.body.data.id;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('config endpoint returns board.triggerSwimlane defined and equal', async () => {
      const res = await request(ctx.app).get(`/api/projects/${projectId}/config`);
      expect(res.status).toBe(200);
      expect(res.body.data.board.triggerSwimlane).toBeDefined();
      expect(res.body.data.board.triggerSwimlane).toBe('investigating');
    });
  });

  describe('trigger does NOT fire when moving within same swimlane', () => {
    let ctx: TestApp;
    let projectId: string;
    let ticketId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_TRIGGER);
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Same Swimlane', sourceKind: 'local', rootPath, config: CONFIG_WITH_TRIGGER });
      projectId = created.body.data.id;

      const ticket = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Already in investigating', swimlane: 'investigating' });
      ticketId = ticket.body.data.id;

      await sleep(50);

      const initialRuns = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(initialRuns.body.data).toHaveLength(0);
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('creating a ticket in trigger swimlane does NOT trigger a run', async () => {
      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.status).toBe(200);
      expect(runsRes.body.data).toHaveLength(0);
    });

    it('moving ticket to the same swimlane DOES trigger a run (current behavior)', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      expect(moveRes.status).toBe(200);
      expect(moveRes.body.data.swimlane).toBe('investigating');

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('multiple moves to trigger swimlane only create one run', () => {
    let ctx: TestApp;
    let projectId: string;
    let ticketId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_TRIGGER);
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Multi Move', sourceKind: 'local', rootPath, config: CONFIG_WITH_TRIGGER });
      projectId = created.body.data.id;

      const ticket = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Multi move ticket', swimlane: 'backlog' });
      ticketId = ticket.body.data.id;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('first move to trigger swimlane creates a run', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      expect(moveRes.status).toBe(200);

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data).toHaveLength(1);
    });

    it('moving away then back to trigger swimlane does NOT create a second run', async () => {
      await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'backlog' });
      await sleep(50);

      await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data).toHaveLength(1);
    });
  });

  describe('trigger swimlane match is exact (no substring match)', () => {
    let ctx: TestApp;
    let projectId: string;
    let ticketId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_TRIGGER);
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Exact Match', sourceKind: 'local', rootPath, config: CONFIG_WITH_TRIGGER });
      projectId = created.body.data.id;

      const ticket = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Exact match test', swimlane: 'backlog' });
      ticketId = ticket.body.data.id;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('moving to a non-trigger swimlane does not create a run', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'done' });
      expect(moveRes.status).toBe(200);

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data).toHaveLength(0);
    });

    it('only exact trigger swimlane match creates a run', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      expect(moveRes.status).toBe(200);

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data).toHaveLength(1);
    });
  });

  describe('move ticket with order parameter still triggers', () => {
    let ctx: TestApp;
    let projectId: string;
    let ticketId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_TRIGGER);
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Order Trigger', sourceKind: 'local', rootPath, config: CONFIG_WITH_TRIGGER });
      projectId = created.body.data.id;

      const ticket = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Order test', swimlane: 'backlog' });
      ticketId = ticket.body.data.id;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('moving with order param still triggers a run', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating', order: 2 });
      expect(moveRes.status).toBe(200);
      expect(moveRes.body.data.swimlane).toBe('investigating');

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data).toHaveLength(1);
    });
  });

  describe('trigger runs when swimlanes[0] matches but NO triggerSwimlane configured', () => {
    let ctx: TestApp;
    let projectId: string;
    let ticketId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo();
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Fallback Test', sourceKind: 'local', rootPath });
      projectId = created.body.data.id;

      const ticket = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Fallback ticket', swimlane: 'in_progress' });
      ticketId = ticket.body.data.id;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('moving to swimlanes[0] (backlog) triggers a run when no triggerSwimlane configured', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'backlog' });
      expect(moveRes.status).toBe(200);
      expect(moveRes.body.data.swimlane).toBe('backlog');

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('trigger with falsy triggerSwimlane falls back to swimlanes[0]', () => {
    let ctx: TestApp;
    let projectId: string;
    let ticketId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo({}, CONFIG_NO_TRIGGER_DIFFERENT_SWIMLANES);
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Falsy Trigger', sourceKind: 'local', rootPath, config: CONFIG_NO_TRIGGER_DIFFERENT_SWIMLANES });
      projectId = created.body.data.id;

      const ticket = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Falsy trigger test', swimlane: 'in_progress' });
      ticketId = ticket.body.data.id;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('moving to swimlanes[0] triggers a run when triggerSwimlane is absent', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'backlog' });
      expect(moveRes.status).toBe(200);
      expect(moveRes.body.data.swimlane).toBe('backlog');

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('moving to a non-first swimlane does NOT trigger when no triggerSwimlane', async () => {
      const ticket2 = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Non-first test', swimlane: 'backlog' });
      const ticket2Id = ticket2.body.data.id;

      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticket2Id}/move`)
        .send({ swimlane: 'done' });
      expect(moveRes.status).toBe(200);

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticket2Id}/runs`);
      expect(runsRes.body.data).toHaveLength(0);
    });
  });

  describe('project with minimal board config should not crash move endpoint', () => {
    let ctx: TestApp;
    let projectId: string;
    let ticketId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo({}, CONFIG_MINIMAL);
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Minimal', sourceKind: 'local', rootPath, config: CONFIG_MINIMAL });
      projectId = created.body.data.id;

      const ticket = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Minimal ticket', swimlane: 'todo' });
      ticketId = ticket.body.data.id;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('move within same swimlane succeeds with minimal config', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'todo' });
      expect(moveRes.status).toBe(200);
      expect(moveRes.body.data.swimlane).toBe('todo');
    });

    it('move to another swimlane succeeds with minimal config', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'todo' });
      expect(moveRes.status).toBe(200);
    });
  });
});
