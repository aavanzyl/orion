import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedProjectRepo, type TestApp } from './app.js';

const SEED_FILES: Record<string, string> = {
  'src/auth.ts':
    'export function authenticate(user: string, password: string) {\n' +
    '  // validate login credentials and issue a session token\n' +
    '  return login(user, password);\n' +
    '}\n',
  'src/math.ts':
    'export function add(a: number, b: number) {\n' +
    '  // arithmetic helpers: add subtract multiply divide numbers\n' +
    '  return a + b;\n' +
    '}\n',
  'notes.md': '# Grocery notes\n\nshopping list: banana apple orange grocery store\n',
};

describe('rag codebase index & search (integration)', () => {
  let ctx: TestApp;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const rootPath = await seedProjectRepo(SEED_FILES);
    const project = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'RAG Project', sourceKind: 'local', rootPath });
    projectId = project.body.data.id;
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('indexes the repo with the local embedding provider and answers a search', async () => {
    const started = await request(ctx.app).post(`/api/projects/${projectId}/index`);
    expect(started.status).toBe(202);
    expect(started.body.data.provider).toBe('local');

    let status = started.body.data.status;
    for (let i = 0; i < 50 && status !== 'ready'; i++) {
      await sleep(200);
      const poll = await request(ctx.app).get(`/api/projects/${projectId}/index`);
      status = poll.body.data.status;
      expect(poll.body.data.status).not.toBe('error');
    }
    expect(status).toBe('ready');

    const search = await request(ctx.app)
      .post(`/api/projects/${projectId}/search`)
      .send({ query: 'authenticate user login password credentials' });
    expect(search.status).toBe(200);

    const results = search.body.data as Array<{ filePath: string; score: number }>;
    expect(results.length).toBeGreaterThan(0);
    // The repo's `.orion/config.yaml` is also indexable, so allow it alongside the seeded sources.
    const indexable = new Set([...Object.keys(SEED_FILES), '.orion/config.yaml']);
    for (const r of results) expect(indexable.has(r.filePath)).toBe(true);
    expect(results[0].filePath).toBe('src/auth.ts');

    const scores = results.map((r) => r.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
    expect(scores[0]).toBeGreaterThan(0);
  });
});
