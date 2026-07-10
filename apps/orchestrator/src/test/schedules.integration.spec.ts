import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedProjectRepo, type TestApp } from './app.js';

describe('schedules (integration)', () => {
  let ctx: TestApp;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const rootPath = await seedProjectRepo();
    const project = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'Schedule Project', sourceKind: 'local', rootPath });
    projectId = project.body.data.id;
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('rejects an invalid cron expression with 422', async () => {
    const res = await request(ctx.app)
      .post(`/api/projects/${projectId}/schedules`)
      .send({ name: 'bad cron', cron: 'not a cron', instruction: 'do things' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('rejects a schedule created without an instruction', async () => {
    const res = await request(ctx.app)
      .post(`/api/projects/${projectId}/schedules`)
      .send({ name: 'no instruction', cron: '0 9 * * *' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('creates a schedule, persists selections, lists it, toggles, and deletes', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/schedules`)
      .send({
        name: 'nightly',
        cron: '0 9 * * *',
        instruction: 'Check for stale dependencies and file a ticket if any are found.',
        skills: ['conventional-commits'],
        mcpServers: ['github'],
        mcpServerConfigs: { github: { url: 'https://api.githubcopilot.com/mcp/' } },
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.cron).toBe('0 9 * * *');
    expect(created.body.data.instruction).toContain('stale dependencies');
    expect(created.body.data.skills).toEqual(['conventional-commits']);
    expect(created.body.data.mcpServers).toEqual(['github']);
    expect(created.body.data.mcpServerConfigs).toEqual({
      github: { url: 'https://api.githubcopilot.com/mcp/' },
    });
    expect(typeof created.body.data.nextFireAt).toBe('string');

    const list = await request(ctx.app).get(`/api/projects/${projectId}/schedules`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((s: { id: string }) => s.id)).toContain(id);

    const disabled = await request(ctx.app).patch(`/api/schedules/${id}`).send({ enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.enabled).toBe(false);

    const updated = await request(ctx.app)
      .patch(`/api/schedules/${id}`)
      .send({ instruction: 'Updated instruction', skills: [] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.instruction).toBe('Updated instruction');
    expect(updated.body.data.skills).toEqual([]);

    const deleted = await request(ctx.app).delete(`/api/schedules/${id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toEqual({ deleted: true });

    const missing = await request(ctx.app).delete(`/api/schedules/${id}`);
    expect(missing.status).toBe(404);
  });

  it('returns the available skills and mcp servers for a project', async () => {
    const res = await request(ctx.app).get(`/api/projects/${projectId}/schedules/options`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.skills)).toBe(true);
    expect(Array.isArray(res.body.data.mcpServers)).toBe(true);
  });
});
