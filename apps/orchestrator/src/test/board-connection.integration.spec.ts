import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { LinearSyncService, type LinearClientFactory } from '../lib/services/linear-sync.service.js';
import { createTestApp, seedProjectRepo, type TestApp } from './app.js';

describe('board connection / linear (integration)', () => {
  let ctx: TestApp;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const rootPath = await seedProjectRepo();
    const project = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'Board Conn Project', sourceKind: 'local', rootPath });
    projectId = project.body.data.id;

    // Swap in a Linear client factory that fails offline so the validation path
    // never touches the network (a bogus key must surface an error, not hang).
    const failing: LinearClientFactory = () => {
      throw new Error('invalid Linear API key');
    };
    ctx.container.linearSync = new LinearSyncService(
      ctx.container.boardConnections,
      ctx.container.tickets,
      ctx.container.projects,
      ctx.container.boards,
      failing,
    );
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('reports not connected before any connection exists', async () => {
    const res = await request(ctx.app).get(`/api/projects/${projectId}/board-connection`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ connected: false });
  });

  it('surfaces an error for a bogus api key without crashing', async () => {
    const res = await request(ctx.app)
      .put(`/api/projects/${projectId}/board-connection`)
      .send({ apiKey: 'lin_api_bogus', teamId: 'team-x' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(600);
    expect(res.body.success).toBe(false);
  });
});
