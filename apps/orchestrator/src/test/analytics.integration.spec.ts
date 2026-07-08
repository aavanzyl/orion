import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app.js';

describe('analytics & dashboard (integration)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('returns an empty runs list when nothing has run', async () => {
    const res = await request(ctx.app).get('/api/runs');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns an analytics summary with the expected shape', async () => {
    const res = await request(ctx.app).get('/api/analytics?days=30');
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toMatchObject({ successRate: 0, totalRuns: 0 });
    expect(Array.isArray(data.runsByDay)).toBe(true);
    expect(Array.isArray(data.byProject)).toBe(true);
    expect(Array.isArray(data.byWorkflow)).toBe(true);
  });
});
