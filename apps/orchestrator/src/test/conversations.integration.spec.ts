import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedProjectRepo, type TestApp } from './app.js';

describe('conversations (integration)', () => {
  let ctx: TestApp;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const rootPath = await seedProjectRepo();
    const project = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'Chat Project', sourceKind: 'local', rootPath });
    projectId = project.body.data.id;
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('creates, lists and fetches a conversation without sending a turn', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/conversations`)
      .send({ title: 'Design chat' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.projectId).toBe(projectId);

    const list = await request(ctx.app).get(`/api/projects/${projectId}/conversations`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(id);

    const detail = await request(ctx.app).get(`/api/conversations/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.conversation.id).toBe(id);
    expect(Array.isArray(detail.body.data.messages)).toBe(true);
    expect(detail.body.data.messages).toHaveLength(0);
  });

  it('404s for an unknown conversation', async () => {
    const res = await request(ctx.app).get('/api/conversations/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
