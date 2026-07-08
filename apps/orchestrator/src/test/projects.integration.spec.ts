import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedProjectRepo, type TestApp } from './app.js';

describe('projects & board (integration)', () => {
  let ctx: TestApp;
  let projectId: string;
  let ticketId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const rootPath = await seedProjectRepo();

    const created = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'Board Project', sourceKind: 'local', rootPath });
    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
    projectId = created.body.data.id;
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('gets and lists the created project', async () => {
    const one = await request(ctx.app).get(`/api/projects/${projectId}`);
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ id: projectId, name: 'Board Project', sourceKind: 'local' });

    const all = await request(ctx.app).get('/api/projects');
    expect(all.status).toBe(200);
    expect(all.body.data.map((p: { id: string }) => p.id)).toContain(projectId);
  });

  it('derives board/workflow from the repo config', async () => {
    const res = await request(ctx.app).get(`/api/projects/${projectId}/config`);
    expect(res.status).toBe(200);
    expect(res.body.data.board.swimlanes).toContain('in_progress');
    expect(res.body.data.workflow.name).toBe('default');
  });

  it('creates a ticket and shows it on the board', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'First ticket', description: 'do a thing', swimlane: 'backlog' });
    expect(created.status).toBe(201);
    ticketId = created.body.data.id;
    expect(created.body.data.swimlane).toBe('backlog');

    const board = await request(ctx.app).get(`/api/projects/${projectId}/board`);
    expect(board.status).toBe(200);
    const backlog = board.body.data.swimlanes.find((c: { key: string }) => c.key === 'backlog');
    expect(backlog.tickets.map((t: { id: string }) => t.id)).toContain(ticketId);
  });

  it('creates and lists labels', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/labels`)
      .send({ name: 'bug', color: '#ff0000' });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('bug');

    const labels = await request(ctx.app).get(`/api/projects/${projectId}/labels`);
    expect(labels.status).toBe(200);
    expect(labels.body.data.map((l: { name: string }) => l.name)).toContain('bug');
  });

  it('moves a ticket to another swimlane', async () => {
    const res = await request(ctx.app)
      .post(`/api/tickets/${ticketId}/move`)
      .send({ swimlane: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.data.swimlane).toBe('in_progress');
  });

  it('patches a ticket', async () => {
    const res = await request(ctx.app)
      .patch(`/api/tickets/${ticketId}`)
      .send({ title: 'Renamed ticket' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Renamed ticket');
  });
});
