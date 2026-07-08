import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app.js';

describe('providers (integration)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('rejects a provider without a key', async () => {
    const res = await request(ctx.app).post('/api/providers').send({ label: 'no key' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('creates, lists, patches and deletes a provider', async () => {
    const created = await request(ctx.app)
      .post('/api/providers')
      .send({ key: 'deepseek', harness: 'codex', label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-coder'] });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.models).toEqual(['deepseek-chat', 'deepseek-coder']);

    const list = await request(ctx.app).get('/api/providers');
    expect(list.status).toBe(200);
    expect(list.body.data.map((p: { id: string }) => p.id)).toContain(id);

    const patched = await request(ctx.app)
      .patch(`/api/providers/${id}`)
      .send({ label: 'DeepSeek Updated' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.label).toBe('DeepSeek Updated');

    const deleted = await request(ctx.app).delete(`/api/providers/${id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toEqual({ deleted: true });

    const missing = await request(ctx.app).patch(`/api/providers/${id}`).send({ label: 'x' });
    expect(missing.status).toBe(404);
  });
});
