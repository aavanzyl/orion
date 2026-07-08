import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedProjectRepo, type TestApp } from './app.js';

describe('triggers (integration)', () => {
  let ctx: TestApp;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const rootPath = await seedProjectRepo();
    const project = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'Trigger Project', sourceKind: 'local', rootPath });
    projectId = project.body.data.id;
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('rejects an invalid cron expression with 422', async () => {
    const res = await request(ctx.app)
      .post(`/api/projects/${projectId}/triggers`)
      .send({ name: 'bad cron', type: 'cron', cron: 'not a cron' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('creates a valid cron trigger, lists it, and toggles enable/disable', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/triggers`)
      .send({ name: 'nightly', type: 'cron', cron: '0 9 * * *' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.cron).toBe('0 9 * * *');

    const list = await request(ctx.app).get(`/api/projects/${projectId}/triggers`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((t: { id: string }) => t.id)).toContain(id);

    const disabled = await request(ctx.app).patch(`/api/triggers/${id}`).send({ enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.enabled).toBe(false);

    const enabled = await request(ctx.app).patch(`/api/triggers/${id}`).send({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.data.enabled).toBe(true);
  });

  it('creates a webhook trigger with a token, then deletes it', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/triggers`)
      .send({ name: 'inbound', type: 'webhook' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.type).toBe('webhook');
    expect(typeof created.body.data.webhookToken).toBe('string');
    expect(created.body.data.webhookToken.length).toBeGreaterThan(0);

    const deleted = await request(ctx.app).delete(`/api/triggers/${id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toEqual({ deleted: true });

    const missing = await request(ctx.app).delete(`/api/triggers/${id}`);
    expect(missing.status).toBe(404);
  });

  it('rejects an agent trigger created without a prompt', async () => {
    const res = await request(ctx.app)
      .post(`/api/projects/${projectId}/triggers`)
      .send({ name: 'daily agent', type: 'cron', cron: '0 9 * * *', action: 'agent' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('creates an agent trigger persisting action, agentId and prompt', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/triggers`)
      .send({
        name: 'daily agent',
        type: 'cron',
        cron: '0 9 * * *',
        action: 'agent',
        agentId: 'implementer',
        prompt: 'Check for stale dependencies and file a ticket if any are found.',
      });
    expect(created.status).toBe(201);
    expect(created.body.data.action).toBe('agent');
    expect(created.body.data.agentId).toBe('implementer');
    expect(created.body.data.prompt).toContain('stale dependencies');

    const detail = await request(ctx.app).get(`/api/projects/${projectId}/triggers`);
    const persisted = detail.body.data.find((t: { id: string }) => t.id === created.body.data.id);
    expect(persisted.action).toBe('agent');
    expect(persisted.prompt).toContain('stale dependencies');
  });
});
