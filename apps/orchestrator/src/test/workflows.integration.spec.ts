import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app.js';

describe('workflow templates (integration)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('lists the built-in template catalog', async () => {
    const res = await request(ctx.app).get('/api/workflows/templates');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const names = res.body.data.map((t: { name: string }) => t.name);
    expect(names).toContain('default');
  });

  it('returns a single template with rendered yaml', async () => {
    const res = await request(ctx.app).get('/api/workflows/templates/default');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('default');
    expect(typeof res.body.data.yaml).toBe('string');
    expect(res.body.data.yaml).toContain('workflow:');
  });

  it('404s for an unknown template', async () => {
    const res = await request(ctx.app).get('/api/workflows/templates/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
