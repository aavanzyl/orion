import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedProjectRepo, type TestApp } from './app.js';

const execAsync = promisify(exec);
const settle = (ms = 1000) => new Promise((r) => setTimeout(r, ms));

async function initGitRepo(dir: string): Promise<void> {
  await execAsync('git init', { cwd: dir });
  await execAsync('git config user.email "test@test.test"', { cwd: dir });
  await execAsync('git config user.name "Test"', { cwd: dir });
  await execAsync('git add -A', { cwd: dir });
  await execAsync('git commit -m "initial"', { cwd: dir });
}

const CONFIG_WITH_ISSUE_TYPES = `project:
  name: type-test
  defaultBranch: main

board:
  swimlanes: [backlog, in_progress, done]

issueTypes:
  - name: bug
    label: Bug
    workflow: bug-workflow

workflows:
  bug-workflow:
    name: bug-workflow
    nodes:
      - id: fix
        type: shell
        script: 'echo fixing'

workflow:
  name: default
  nodes:
    - id: implement
      type: agent
      provider: codex
      model: gpt-5-codex
      swimlane: in_progress
`;

describe('run lifecycle (integration)', () => {
  let ctx: TestApp;
  let projectId: string;
  let ticketId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const rootPath = await seedProjectRepo();
    await initGitRepo(rootPath);
    const project = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'Run Lifecycle Project', sourceKind: 'local', rootPath });
    projectId = project.body.data.id;

    const ticket = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Lifecycle ticket', swimlane: 'backlog' });
    ticketId = ticket.body.data.id;
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('starts a run manually', async () => {
    const res = await request(ctx.app).post(`/api/tickets/${ticketId}/run`);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      ticketId,
      status: 'created',
      workflowName: 'default',
    });
    expect(typeof res.body.data.id).toBe('string');
  });

  it('lists runs for a ticket', async () => {
    const res = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].ticketId).toBe(ticketId);
  });

  it('gets run detail with nodes', async () => {
    const start = await request(ctx.app).post(`/api/tickets/${ticketId}/run`);
    const runId = start.body.data.id;

    const res = await request(ctx.app).get(`/api/runs/${runId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.run.id).toBe(runId);
    expect(res.body.data.run.ticketId).toBe(ticketId);
    expect(Array.isArray(res.body.data.nodes)).toBe(true);
    expect(res.body.data.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('lists run events', async () => {
    const start = await request(ctx.app).post(`/api/tickets/${ticketId}/run`);
    const runId = start.body.data.id;
    await settle(500);

    const res = await request(ctx.app).get(`/api/runs/${runId}/events`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('lists ticket logs across all runs', async () => {
    const start = await request(ctx.app).post(`/api/tickets/${ticketId}/run`);
    const runId = start.body.data.id;
    await settle(500);

    const res = await request(ctx.app).get(`/api/tickets/${ticketId}/logs`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some((e: { runId: string }) => e.runId === runId)).toBe(true);

    const typeFiltered = await request(ctx.app).get(
      `/api/tickets/${ticketId}/logs?type=run.created`,
    );
    expect(typeFiltered.status).toBe(200);
    expect(typeFiltered.body.data.length).toBeGreaterThanOrEqual(1);
    expect(typeFiltered.body.data.every((e: { type: string }) => e.type === 'run.created')).toBe(
      true,
    );

    const limited = await request(ctx.app).get(`/api/tickets/${ticketId}/logs?limit=5`);
    expect(limited.status).toBe(200);
    expect(limited.body.data.length).toBeLessThanOrEqual(5);
  });

  it('starts run with issueType workflow resolution', async () => {
    const rootPath = await seedProjectRepo({}, CONFIG_WITH_ISSUE_TYPES);
    await initGitRepo(rootPath);
    const project = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'Issue Type Run Project', sourceKind: 'local', rootPath, config: CONFIG_WITH_ISSUE_TYPES });
    const issueTypeProjectId = project.body.data.id;

    const ticket = await request(ctx.app)
      .post(`/api/projects/${issueTypeProjectId}/tickets`)
      .send({ title: 'A bug to fix', type: 'bug', swimlane: 'backlog' });
    const bugTicketId = ticket.body.data.id;

    const res = await request(ctx.app).post(`/api/tickets/${bugTicketId}/run`);
    expect(res.status).toBe(201);
    expect(res.body.data.workflowName).toBe('bug-workflow');
  });

  it('lists all runs with filters', async () => {
    const t1 = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Filter ticket 1', swimlane: 'backlog' });
    const t2 = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Filter ticket 2', swimlane: 'backlog' });

    await request(ctx.app).post(`/api/tickets/${t1.body.data.id}/run`);
    await request(ctx.app).post(`/api/tickets/${t2.body.data.id}/run`);
    await settle(500);

    const all = await request(ctx.app).get(`/api/runs?projectId=${projectId}`);
    expect(all.status).toBe(200);
    expect(Array.isArray(all.body.data)).toBe(true);
    expect(all.body.data.length).toBeGreaterThanOrEqual(2);

    const byStatus = await request(ctx.app).get(
      `/api/runs?projectId=${projectId}&status=created,failed`,
    );
    expect(byStatus.status).toBe(200);
    expect(Array.isArray(byStatus.body.data)).toBe(true);
    if (byStatus.body.data.length > 0) {
      expect(
        byStatus.body.data.every((r: { status: string }) =>
          ['created', 'failed'].includes(r.status),
        ),
      ).toBe(true);
    }

    const limited = await request(ctx.app).get(`/api/runs?projectId=${projectId}&limit=1`);
    expect(limited.status).toBe(200);
    expect(limited.body.data.length).toBeLessThanOrEqual(1);
  });

  it('cancels a run', async () => {
    const start = await request(ctx.app).post(`/api/tickets/${ticketId}/run`);
    expect(start.status).toBe(201);
    const runId = start.body.data.id;

    const cancel = await request(ctx.app).post(`/api/runs/${runId}/cancel`);
    expect(cancel.status).toBe(200);

    const detail = await request(ctx.app).get(`/api/runs/${runId}`);
    expect(detail.body.data.run.status).toBe('cancelled');

    const events = await request(ctx.app).get(`/api/runs/${runId}/events`);
    const cancelledEvent = events.body.data.find(
      (e: { type: string; payload?: { status?: string } }) =>
        e.type === 'run.status' && e.payload?.status === 'cancelled',
    );
    expect(cancelledEvent).toBeDefined();
  });

  it('retries a cancelled/failed run', async () => {
    const start = await request(ctx.app).post(`/api/tickets/${ticketId}/run`);
    expect(start.status).toBe(201);
    const runId = start.body.data.id;

    const cancel = await request(ctx.app).post(`/api/runs/${runId}/cancel`);
    expect(cancel.status).toBe(200);

    const retry = await request(ctx.app).post(`/api/runs/${runId}/retry`);
    expect(retry.status).toBe(201);
    expect(retry.body.data.status).not.toBe('cancelled');
  });

  it('multiple runs per ticket', async () => {
    await request(ctx.app).post(`/api/tickets/${ticketId}/run`);
    await request(ctx.app).post(`/api/tickets/${ticketId}/run`);

    const list = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('run events include run.created type', async () => {
    const start = await request(ctx.app).post(`/api/tickets/${ticketId}/run`);
    const runId = start.body.data.id;
    await settle(500);

    const events = await request(ctx.app).get(`/api/runs/${runId}/events`);
    expect(events.body.data.some((e: { type: string }) => e.type === 'run.created')).toBe(true);
  });
});
