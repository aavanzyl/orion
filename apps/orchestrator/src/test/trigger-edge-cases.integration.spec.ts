import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedProjectRepo, type TestApp } from './app.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CONFIG_WITH_START_SWIMLANE = `project:
  name: config-test
  defaultBranch: main
board:
  swimlanes: [backlog, investigating, done]
workflow:
  name: default
  nodes:
    - id: test
      type: shell
      script: 'echo test'
      swimlane: investigating
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

const CONFIG_LEGACY_TRIGGER_SWIMLANE = `project:
  name: legacy-trigger
  defaultBranch: main
board:
  swimlanes: [backlog, investigating, done]
  triggerSwimlane: investigating
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
        .send({ swimlane: 'in_progress' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.swimlane).toBe('in_progress');

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.status).toBe(200);
      expect(runsRes.body.data).toHaveLength(0);
    });
  });

  describe('legacy triggerSwimlane in YAML is ignored', () => {
    let ctx: TestApp;
    let projectId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo({}, CONFIG_LEGACY_TRIGGER_SWIMLANE);
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Legacy Trigger', sourceKind: 'local', rootPath, config: CONFIG_LEGACY_TRIGGER_SWIMLANE });
      projectId = created.body.data.id;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('config still parses and board omits triggerSwimlane', async () => {
      const res = await request(ctx.app).get(`/api/projects/${projectId}/config`);
      expect(res.status).toBe(200);
      expect(res.body.data.board.swimlanes).toEqual(['backlog', 'investigating', 'done']);
      expect(res.body.data.board.triggerSwimlane).toBeUndefined();
    });

    it('moving to the legacy triggerSwimlane does NOT create a run when no start node matches', async () => {
      const ticket = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Legacy trigger ticket', swimlane: 'backlog' });
      const ticketId = ticket.body.data.id;

      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      expect(moveRes.status).toBe(200);

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data).toHaveLength(0);
    });
  });

  describe('trigger fires when moving within the same start node swimlane', () => {
    let ctx: TestApp;
    let projectId: string;
    let ticketId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_START_SWIMLANE);
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Same Swimlane', sourceKind: 'local', rootPath, config: CONFIG_WITH_START_SWIMLANE });
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

    it('creating a ticket in the start node swimlane does NOT trigger a run', async () => {
      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.status).toBe(200);
      expect(runsRes.body.data).toHaveLength(0);
    });

    it('moving ticket to the same swimlane DOES trigger a run (current behavior)', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      expect(moveRes.status).toBe(200);
      expect(moveRes.body.data.ticket.swimlane).toBe('investigating');

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('multiple moves to the start node swimlane only create one run', () => {
    let ctx: TestApp;
    let projectId: string;
    let ticketId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_START_SWIMLANE);
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Multi Move', sourceKind: 'local', rootPath, config: CONFIG_WITH_START_SWIMLANE });
      projectId = created.body.data.id;

      const ticket = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Multi move ticket', swimlane: 'backlog' });
      ticketId = ticket.body.data.id;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('first move to the start node swimlane creates a run', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      expect(moveRes.status).toBe(200);

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data).toHaveLength(1);
    });

    it('moving away then back creates a second run (terminal history no longer blocks)', async () => {
      await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'backlog' });
      await sleep(500);

      await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      await sleep(500);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data).toHaveLength(2);
    });
  });

  describe('start node swimlane match is exact', () => {
    let ctx: TestApp;
    let projectId: string;
    let ticketId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_START_SWIMLANE);
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Exact Match', sourceKind: 'local', rootPath, config: CONFIG_WITH_START_SWIMLANE });
      projectId = created.body.data.id;

      const ticket = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Exact match test', swimlane: 'backlog' });
      ticketId = ticket.body.data.id;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('moving to an unrelated swimlane does not create a run', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'done' });
      expect(moveRes.status).toBe(200);

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data).toHaveLength(0);
    });

    it('only the exact start node swimlane match creates a run', async () => {
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
      const rootPath = await seedProjectRepo({}, CONFIG_WITH_START_SWIMLANE);
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Order Trigger', sourceKind: 'local', rootPath, config: CONFIG_WITH_START_SWIMLANE });
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
      expect(moveRes.body.data.ticket.swimlane).toBe('investigating');

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data).toHaveLength(1);
    });
  });

  describe('default template config triggers on its start node swimlane only', () => {
    let ctx: TestApp;
    let projectId: string;
    let ticketId: string;

    beforeAll(async () => {
      ctx = await createTestApp();
      const rootPath = await seedProjectRepo();
      const created = await request(ctx.app)
        .post('/api/projects')
        .send({ name: 'Sample Config Trigger', sourceKind: 'local', rootPath });
      projectId = created.body.data.id;

      const ticket = await request(ctx.app)
        .post(`/api/projects/${projectId}/tickets`)
        .send({ title: 'Sample ticket', swimlane: 'backlog' });
      ticketId = ticket.body.data.id;
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('moving to a swimlane without a node (backlog) does NOT trigger', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'backlog' });
      expect(moveRes.status).toBe(200);

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data).toHaveLength(0);
    });

    it('moving to a dependent node swimlane (in_progress) does NOT trigger', async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'in_progress' });
      expect(moveRes.status).toBe(200);

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data).toHaveLength(0);
    });

    it("moving to the start node's swimlane (investigating) triggers a run", async () => {
      const moveRes = await request(ctx.app)
        .post(`/api/tickets/${ticketId}/move`)
        .send({ swimlane: 'investigating' });
      expect(moveRes.status).toBe(200);
      expect(moveRes.body.data.ticket.swimlane).toBe('investigating');

      await sleep(50);

      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.body.data.length).toBeGreaterThanOrEqual(1);
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
      expect(moveRes.body.data.ticket.swimlane).toBe('todo');
    });

    it('does not create a run when no node is bound to the swimlane', async () => {
      await sleep(50);
      const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
      expect(runsRes.status).toBe(200);
      expect(runsRes.body.data).toHaveLength(0);
    });
  });
});
