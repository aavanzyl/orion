import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { RemoteBoardClientFactory } from '@orion/board-core';
import { BoardSyncService } from '../lib/services/board-sync.service.js';
import { createTestApp, seedProjectRepo, type TestApp } from './app.js';

const execAsync = promisify(exec);

async function initGitRepo(dir: string): Promise<void> {
  await execAsync('git init', { cwd: dir });
  await execAsync('git config user.email "test@test.test"', { cwd: dir });
  await execAsync('git config user.name "Test"', { cwd: dir });
  await execAsync('git add -A', { cwd: dir });
  await execAsync('git commit -m "initial"', { cwd: dir });
}

const CONFIG_WITH_TRIGGER_SWIMLANE = `project:
  name: regression-trigger-test
  defaultBranch: main
board:
  swimlanes: [backlog, investigating, done]
workflow:
  name: default
  nodes:
    - id: investigate
      type: agent
      provider: deepseek
      model: deepseek-v4-flash
      swimlane: investigating
`;

describe('board connection / sync (integration)', () => {
  let ctx: TestApp;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const rootPath = await seedProjectRepo();
    const project = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'Board Conn Project', sourceKind: 'local', rootPath });
    projectId = project.body.data.id;

    // Swap in provider factories that fail offline so credential validation
    // never touches the network (a bogus key must surface an error, not hang).
    const failing: RemoteBoardClientFactory = () => {
      throw new Error('invalid API key');
    };
    ctx.container.boardSync = new BoardSyncService(
      ctx.container.boardConnections,
      ctx.container.tickets,
      ctx.container.projects,
      ctx.container.labels,
      ctx.container.epics,
      ctx.container.boards,
      ctx.container.bus,
      undefined,
      { linear: failing, jira: failing, trello: failing },
    );
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('reports not connected before any connection exists', async () => {
    const res = await request(ctx.app).get(`/api/projects/${projectId}/board-connection`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ connected: false });
  });

  it('surfaces an error for a bogus api key without crashing', async () => {
    const res = await request(ctx.app)
      .put(`/api/projects/${projectId}/board-connection`)
      .send({ apiKey: 'lin_api_bogus', teamId: 'team-x' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(600);
    expect(res.body.success).toBe(false);
  });

  it('does not accept triggerOnImport in PUT body', async () => {
    await ctx.container.boardConnections.upsert(projectId, {
      provider: 'linear',
      apiKey: 'enc:x',
      teamId: 'team-x',
    });

    const res = await request(ctx.app)
      .put(`/api/projects/${projectId}/board-connection`)
      .send({ triggerOnImport: true });
    expect(res.status).toBe(200);
  });

  it('returns lastSync null when no sync has occurred', async () => {
    await ctx.container.boardConnections.upsert(projectId, {
      provider: 'linear',
      apiKey: 'enc:x',
      teamId: 'team-x',
    });

    const res = await request(ctx.app).get(`/api/projects/${projectId}/board-connection`);
    expect(res.status).toBe(200);
    expect(res.body.data.lastSync).toBeNull();
  });

  it('returns lastSync with data after a sync log is seeded', async () => {
    await ctx.container.boardConnections.upsert(projectId, {
      provider: 'linear',
      apiKey: 'enc:x',
      teamId: 'team-x',
    });

    await ctx.container.boardConnections.insertSyncLog({
      projectId,
      startedAt: new Date(Date.now() - 5000).toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'completed',
      imported: 5,
      updated: 2,
      epicsLinked: 1,
      error: null,
      durationMs: 4200,
      trigger: 'manual',
    });

    const res = await request(ctx.app).get(`/api/projects/${projectId}/board-connection`);
    expect(res.status).toBe(200);
    expect(res.body.data.lastSync).toBeDefined();
    expect(res.body.data.lastSync.status).toBe('completed');
    expect(res.body.data.lastSync.imported).toBe(5);
    expect(res.body.data.lastSync.updated).toBe(2);
    expect(res.body.data.lastSync.epicsLinked).toBe(1);
    expect(res.body.data.lastSync.durationMs).toBe(4200);
  });

  it('GET sync-history returns newest-first array', async () => {
    await ctx.container.boardConnections.upsert(projectId, {
      provider: 'linear',
      apiKey: 'enc:x',
      teamId: 'team-x',
    });

    const before = await ctx.container.boardConnections.getSyncLogs(projectId, 20);
    const prevCount = before.length;

    await ctx.container.boardConnections.insertSyncLog({
      projectId,
      startedAt: new Date(Date.now() - 10000).toISOString(),
      finishedAt: new Date(Date.now() - 5000).toISOString(),
      status: 'completed',
      imported: 10,
      updated: 0,
      epicsLinked: 2,
      error: null,
      durationMs: 5000,
      trigger: 'manual',
    });

    await ctx.container.boardConnections.insertSyncLog({
      projectId,
      startedAt: new Date(Date.now() - 2000).toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'failed',
      imported: 0,
      updated: 0,
      epicsLinked: 0,
      error: 'Connection timeout',
      durationMs: 1500,
      trigger: 'auto',
    });

    const res = await request(ctx.app).get(`/api/projects/${projectId}/board-connection/sync-history`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(prevCount + 2);
    expect(res.body.data[0].status).toBe('failed');
    expect(res.body.data[0].trigger).toBe('auto');
    expect(res.body.data[0].error).toBe('Connection timeout');
    // The 10-imported log is somewhere in the array; find it.
    const imported10 = res.body.data.find(
      (l: Record<string, unknown>) => l.status === 'completed' && l.imported === 10,
    );
    expect(imported10).toBeDefined();
    expect(imported10.epicsLinked).toBe(2);
    expect(imported10.trigger).toBe('manual');
  });

  it('POST tickets into a trigger swimlane does NOT start a run', async () => {
    const rootPath = await seedProjectRepo({}, CONFIG_WITH_TRIGGER_SWIMLANE);
    await initGitRepo(rootPath);
    const projRes = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'Regression Trigger Project', sourceKind: 'local', rootPath });
    const regProjectId = projRes.body.data.id;

    const ticketRes = await request(ctx.app)
      .post(`/api/projects/${regProjectId}/tickets`)
      .send({ title: 'test ticket', swimlane: 'investigating' });
    expect(ticketRes.status).toBe(201);
    const ticketId = ticketRes.body.data.id;

    // Wait briefly for any async trigger to fire, then check no runs exist.
    await new Promise((r) => setTimeout(r, 500));

    const runsRes = await request(ctx.app).get(`/api/tickets/${ticketId}/runs`);
    expect(runsRes.status).toBe(200);
    expect(Array.isArray(runsRes.body.data)).toBe(true);
    expect(runsRes.body.data.length).toBe(0);
  });
});
