import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedProjectRepo, SAMPLE_CONFIG_YAML, type TestApp } from './app.js';

describe('ticket CRUD (integration)', () => {
  let ctx: TestApp;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const rootPath = await seedProjectRepo();

    const created = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'Ticket CRUD Project', sourceKind: 'local', rootPath });
    expect(created.status).toBe(201);
    projectId = created.body.data.id;
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('creates a ticket with defaults and reads detail', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Test', swimlane: 'backlog' });
    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
    expect(created.body.data.title).toBe('Test');
    expect(created.body.data.swimlane).toBe('backlog');
    expect(created.body.data.type).toBe('feature');
    expect(created.body.data.priority).toBe(0);

    const detail = await request(ctx.app).get(`/api/tickets/${created.body.data.id}/detail`);
    expect(detail.status).toBe(200);
    expect(detail.body.success).toBe(true);
    expect(detail.body.data.id).toBe(created.body.data.id);
    expect(detail.body.data.title).toBe('Test');
    expect(detail.body.data.swimlane).toBe('backlog');
    expect(detail.body.data.type).toBe('feature');
    expect(detail.body.data.priority).toBe(0);
    expect(detail.body.data.labels).toEqual([]);
  });

  it('creates a ticket with all optional fields', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({
        title: 'Full Fields',
        description: 'A detailed description',
        swimlane: 'backlog',
        type: 'bug',
        priority: 2,
        startDate: '2026-01-01',
        dueDate: '2026-01-15',
      });
    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
    expect(created.body.data.title).toBe('Full Fields');
    expect(created.body.data.description).toBe('A detailed description');
    expect(created.body.data.swimlane).toBe('backlog');
    expect(created.body.data.type).toBe('bug');
    expect(created.body.data.priority).toBe(2);
    expect(created.body.data.startDate).toBeTruthy();
    expect(created.body.data.dueDate).toBeTruthy();
  });

  it('updates a ticket', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Original', swimlane: 'backlog' });
    expect(created.status).toBe(201);
    const ticketId = created.body.data.id;

    const updated = await request(ctx.app)
      .patch(`/api/tickets/${ticketId}`)
      .send({ title: 'New Title', swimlane: 'in_progress', priority: 3, type: 'issue' });
    expect(updated.status).toBe(200);
    expect(updated.body.success).toBe(true);
    expect(updated.body.data.title).toBe('New Title');
    expect(updated.body.data.swimlane).toBe('in_progress');
    expect(updated.body.data.priority).toBe(3);
    expect(updated.body.data.type).toBe('issue');
  });

  it('deletes a ticket', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'To Delete', swimlane: 'backlog' });
    expect(created.status).toBe(201);
    const ticketId = created.body.data.id;

    const deleted = await request(ctx.app).delete(`/api/tickets/${ticketId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.deleted).toBe(true);

    const detail = await request(ctx.app).get(`/api/tickets/${ticketId}/detail`);
    expect(detail.status).toBe(404);
    expect(detail.body.success).toBe(false);
  });

  it('creates ticket with labels', async () => {
    const label = await request(ctx.app)
      .post(`/api/projects/${projectId}/labels`)
      .send({ name: 'bug', color: '#ff0000' });
    expect(label.status).toBe(201);
    const labelId = label.body.data.id;

    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Labeled Ticket', swimlane: 'backlog', labelIds: [labelId] });
    expect(created.status).toBe(201);

    const detail = await request(ctx.app).get(`/api/tickets/${created.body.data.id}/detail`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.labels).toHaveLength(1);
    expect(detail.body.data.labels[0].id).toBe(labelId);
    expect(detail.body.data.labels[0].name).toBe('bug');
  });

  it('creates and manages labels', async () => {
    const label1 = await request(ctx.app)
      .post(`/api/projects/${projectId}/labels`)
      .send({ name: 'urgent', color: '#ff0000' });
    expect(label1.status).toBe(201);

    const label2 = await request(ctx.app)
      .post(`/api/projects/${projectId}/labels`)
      .send({ name: 'low-priority', color: '#00ff00' });
    expect(label2.status).toBe(201);

    const list = await request(ctx.app).get(`/api/projects/${projectId}/labels`);
    expect(list.status).toBe(200);
    const names = list.body.data.map((l: { name: string }) => l.name);
    expect(names).toContain('urgent');
    expect(names).toContain('low-priority');

    const del = await request(ctx.app).delete(`/api/labels/${label1.body.data.id}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    const after = await request(ctx.app).get(`/api/projects/${projectId}/labels`);
    expect(after.status).toBe(200);
    const afterNames = after.body.data.map((l: { name: string }) => l.name);
    expect(afterNames).not.toContain('urgent');
    expect(afterNames).toContain('low-priority');
  });

  it('creates, lists, updates, and deletes epics', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/epics`)
      .send({ title: 'Sprint 1', description: 'First sprint', color: '#0000ff' });
    expect(created.status).toBe(201);
    expect(created.body.data.title).toBe('Sprint 1');

    const list = await request(ctx.app).get(`/api/projects/${projectId}/epics`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((e: { id: string }) => e.id)).toContain(created.body.data.id);

    const updated = await request(ctx.app)
      .patch(`/api/epics/${created.body.data.id}`)
      .send({ title: 'Sprint 1 Updated', color: '#ff00ff' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.title).toBe('Sprint 1 Updated');

    const del = await request(ctx.app).delete(`/api/epics/${created.body.data.id}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    const after = await request(ctx.app).get(`/api/projects/${projectId}/epics`);
    expect(after.status).toBe(200);
    expect(after.body.data.map((e: { id: string }) => e.id)).not.toContain(created.body.data.id);
  });

  it('creates ticket in an epic', async () => {
    const epic = await request(ctx.app)
      .post(`/api/projects/${projectId}/epics`)
      .send({ title: 'Feature Epic' });
    expect(epic.status).toBe(201);
    const epicId = epic.body.data.id;

    const ticket = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({
        title: 'Epic Ticket',
        swimlane: 'backlog',
        epicId,
        startDate: '2026-03-01',
        dueDate: '2026-03-15',
      });
    expect(ticket.status).toBe(201);

    const detail = await request(ctx.app).get(`/api/tickets/${ticket.body.data.id}/detail`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.epicId).toBe(epicId);
  });

  it('creates a subtask via parentId inheritance', async () => {
    const parent = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Parent', swimlane: 'backlog', priority: 3 });
    expect(parent.status).toBe(201);
    const parentId = parent.body.data.id;

    const child = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Child', swimlane: 'backlog', parentId });
    expect(child.status).toBe(201);
    expect(child.body.data.priority).toBe(3);
    expect(child.body.data.epicId).toBeUndefined();

    const detail = await request(ctx.app).get(`/api/tickets/${child.body.data.id}/detail`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.priority).toBe(3);
  });

  it('assigns and unassigns an agent', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Agent Ticket', swimlane: 'backlog' });
    expect(created.status).toBe(201);
    const ticketId = created.body.data.id;

    const agentId = '550e8400-e29b-41d4-a716-446655440000';
    const assigned = await request(ctx.app)
      .post(`/api/tickets/${ticketId}/agent`)
      .send({ agentId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.agentId).toBe(agentId);

    const unassigned = await request(ctx.app)
      .post(`/api/tickets/${ticketId}/agent`)
      .send({ agentId: null });
    expect(unassigned.status).toBe(200);
    expect(unassigned.body.data.agentId).toBeUndefined();
  });

  it('creates and removes ticket relations', async () => {
    const ticket1 = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Blocking Ticket', swimlane: 'backlog' });
    expect(ticket1.status).toBe(201);

    const ticket2 = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Blocked Ticket', swimlane: 'backlog' });
    expect(ticket2.status).toBe(201);

    const relation = await request(ctx.app)
      .post(`/api/tickets/${ticket1.body.data.id}/relations`)
      .send({ kind: 'blocks', ticketId: ticket2.body.data.id });
    expect(relation.status).toBe(201);
    expect(relation.body.data.type).toBe('blocks');
    const relationId = relation.body.data.id;

    const detail = await request(ctx.app).get(`/api/tickets/${ticket1.body.data.id}/detail`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.relations).toHaveLength(1);
    expect(detail.body.data.relations[0].kind).toBe('blocks');
    expect(detail.body.data.relations[0].ticket.id).toBe(ticket2.body.data.id);

    const removed = await request(ctx.app).delete(`/api/ticket-relations/${relationId}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data.deleted).toBe(true);

    const after = await request(ctx.app).get(`/api/tickets/${ticket1.body.data.id}/detail`);
    expect(after.status).toBe(200);
    expect(after.body.data.relations).toHaveLength(0);
  });

  it('404 on non-existent ticket detail', async () => {
    const res = await request(ctx.app).get('/api/tickets/00000000-0000-0000-0000-000000000000/detail');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('list all tickets', async () => {
    const created1 = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'List Ticket 1', swimlane: 'backlog' });
    expect(created1.status).toBe(201);

    const created2 = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'List Ticket 2', swimlane: 'backlog' });
    expect(created2.status).toBe(201);

    const all = await request(ctx.app).get('/api/tickets');
    expect(all.status).toBe(200);
    const ids = all.body.data.map((t: { id: string }) => t.id);
    expect(ids).toContain(created1.body.data.id);
    expect(ids).toContain(created2.body.data.id);
  });
});
