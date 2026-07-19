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
    const ticket = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Detail test ticket', swimlane: 'backlog' });
    const detailTicketId = ticket.body.data.id;

    const start = await request(ctx.app).post(`/api/tickets/${detailTicketId}/run`);
    const runId = start.body.data.id;

    const res = await request(ctx.app).get(`/api/runs/${runId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.run.id).toBe(runId);
    expect(res.body.data.run.ticketId).toBe(detailTicketId);
    expect(Array.isArray(res.body.data.nodes)).toBe(true);
    expect(res.body.data.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('lists run events', async () => {
    const ticket = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Events test ticket', swimlane: 'backlog' });
    const eventsTicketId = ticket.body.data.id;

    const start = await request(ctx.app).post(`/api/tickets/${eventsTicketId}/run`);
    const runId = start.body.data.id;
    await settle(500);

    const res = await request(ctx.app).get(`/api/runs/${runId}/events`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('lists ticket logs across all runs', async () => {
    const ticket = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Logs test ticket', swimlane: 'backlog' });
    const logsTicketId = ticket.body.data.id;

    const start = await request(ctx.app).post(`/api/tickets/${logsTicketId}/run`);
    const runId = start.body.data.id;
    await settle(500);

    const res = await request(ctx.app).get(`/api/tickets/${logsTicketId}/logs`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some((e: { runId: string }) => e.runId === runId)).toBe(true);

    const typeFiltered = await request(ctx.app).get(
      `/api/tickets/${logsTicketId}/logs?type=run.created`,
    );
    expect(typeFiltered.status).toBe(200);
    expect(typeFiltered.body.data.length).toBeGreaterThanOrEqual(1);
    expect(typeFiltered.body.data.every((e: { type: string }) => e.type === 'run.created')).toBe(
      true,
    );

    const limited = await request(ctx.app).get(`/api/tickets/${logsTicketId}/logs?limit=5`);
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
    const ticket = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Cancel test ticket', swimlane: 'backlog' });
    const cancelTicketId = ticket.body.data.id;

    const start = await request(ctx.app).post(`/api/tickets/${cancelTicketId}/run`);
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
    const ticket = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Retry test ticket', swimlane: 'backlog' });
    const retryTicketId = ticket.body.data.id;

    const start = await request(ctx.app).post(`/api/tickets/${retryTicketId}/run`);
    expect(start.status).toBe(201);
    const runId = start.body.data.id;

    const cancel = await request(ctx.app).post(`/api/runs/${runId}/cancel`);
    expect(cancel.status).toBe(200);

    const retry = await request(ctx.app).post(`/api/runs/${runId}/retry`);
    expect(retry.status).toBe(201);
    expect(retry.body.data.status).not.toBe('cancelled');
  });

  it('retry resets ALL nodes to pending (full re-execution against fresh worktree)', async () => {
    const configYaml = `project:
  name: retry-reset-test
  defaultBranch: main

board:
  swimlanes: [backlog, in_progress, done]

workflow:
  name: default
  nodes:
    - id: step-one
      type: shell
      script: 'echo "ok"'
    - id: step-two
      type: shell
      script: 'exit 1'
      dependsOn: [step-one]
`;
    const rootPath = await seedProjectRepo({}, configYaml);
    await initGitRepo(rootPath);
    const project = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'Retry Reset Project', sourceKind: 'local', rootPath, config: configYaml });
    const resetProjectId = project.body.data.id;

    const ticket = await request(ctx.app)
      .post(`/api/projects/${resetProjectId}/tickets`)
      .send({ title: 'Retry reset ticket', swimlane: 'backlog' });
    const resetTicketId = ticket.body.data.id;

    const start = await request(ctx.app).post(`/api/tickets/${resetTicketId}/run`);
    expect(start.status).toBe(201);
    const runId = start.body.data.id;
    await settle(1000);

    // Verify step-one completed and step-two failed before retry
    const beforeDetail = await request(ctx.app).get(`/api/runs/${runId}`);
    const beforeNodes = beforeDetail.body.data.nodes as { nodeKey: string; status: string }[];
    const stepOneBefore = beforeNodes.find((n) => n.nodeKey === 'step-one');
    const stepTwoBefore = beforeNodes.find((n) => n.nodeKey === 'step-two');
    expect(stepOneBefore?.status).toBe('completed');
    expect(stepTwoBefore?.status).toBe('failed');

    // Retry the failed run
    const retry = await request(ctx.app).post(`/api/runs/${runId}/retry`);
    expect(retry.status).toBe(201);

    // Wait for re-execution
    await settle(1000);

    // After retry, step-two will fail again but step-one must have been re-executed
    const afterDetail = await request(ctx.app).get(`/api/runs/${runId}`);
    const afterNodes = afterDetail.body.data.nodes as { nodeKey: string; status: string; error: string | null }[];
    const stepOneAfter = afterNodes.find((n) => n.nodeKey === 'step-one');
    const stepTwoAfter = afterNodes.find((n) => n.nodeKey === 'step-two');

    // Both nodes were reset to pending and re-executed.
    // step-one (echo "ok") succeeds again; step-two (exit 1) fails again.
    expect(stepOneAfter?.status).toBe('completed');
    expect(stepTwoAfter?.status).toBe('failed');

    // Verify the log event mentions full re-run semantics
    const events = await request(ctx.app).get(`/api/runs/${runId}/events`);
    const logEvents = events.body.data.filter(
      (e: { type: string; payload?: { message?: string } }) =>
        e.type === 'log' && e.payload?.message?.includes('recreated from the base branch'),
    );
    expect(logEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('multiple runs per ticket', async () => {
    const ticket = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Multi-run ticket', swimlane: 'backlog' });
    const multiTicketId = ticket.body.data.id;

    await request(ctx.app).post(`/api/tickets/${multiTicketId}/run`);
    // Cancel the first run so it's not active when starting the second.
    // The active-run guard blocks starting a second run while one is in-flight.
    const runs = await request(ctx.app).get(`/api/tickets/${multiTicketId}/runs`);
    const firstRunId = runs.body.data[0]?.id;
    if (firstRunId) {
      await request(ctx.app).post(`/api/runs/${firstRunId}/cancel`);
      await settle(200);
    }
    await request(ctx.app).post(`/api/tickets/${multiTicketId}/run`);

    const list = await request(ctx.app).get(`/api/tickets/${multiTicketId}/runs`);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('run events include run.created type', async () => {
    const ticket = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'RunCreated test ticket', swimlane: 'backlog' });
    const createdTicketId = ticket.body.data.id;

    const start = await request(ctx.app).post(`/api/tickets/${createdTicketId}/run`);
    const runId = start.body.data.id;
    await settle(500);

    const events = await request(ctx.app).get(`/api/runs/${runId}/events`);
    expect(events.body.data.some((e: { type: string }) => e.type === 'run.created')).toBe(true);
  });

  it('filters run events by nodeKey (friendly name)', async () => {
    const configYaml = `project:
  name: nodekey-filter
  defaultBranch: main

board:
  swimlanes: [backlog, in_progress, done]

workflow:
  name: default
  nodes:
    - id: step-one
      type: shell
      script: 'echo "ok"'
      column: in_progress
    - id: step-two
      type: shell
      script: 'echo "ok"'
      dependsOn: [step-one]
      column: done
`;
    const rootPath = await seedProjectRepo({}, configYaml);
    await initGitRepo(rootPath);
    const project = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'NodeKey Filter Project', sourceKind: 'local', rootPath, config: configYaml });
    const filterProjectId = project.body.data.id;

    const ticket = await request(ctx.app)
      .post(`/api/projects/${filterProjectId}/tickets`)
      .send({ title: 'Filter test ticket', swimlane: 'backlog' });
    const filterTicketId = ticket.body.data.id;

    const start = await request(ctx.app).post(`/api/tickets/${filterTicketId}/run`);
    const runId = start.body.data.id;
    await settle(1000);

    const detail = await request(ctx.app).get(`/api/runs/${runId}`);
    const nodes = detail.body.data.nodes as { id: string; nodeKey: string }[];
    const stepOneNode = nodes.find((n: { nodeKey: string }) => n.nodeKey === 'step-one');
    expect(stepOneNode).toBeDefined();

    // Filter by nodeKey (friendly name)
    const byKey = await request(ctx.app).get(
      `/api/runs/${runId}/events?nodeId=step-one`,
    );
    expect(byKey.status).toBe(200);
    expect(Array.isArray(byKey.body.data)).toBe(true);
    if (byKey.body.data.length > 0 && stepOneNode) {
      expect(
        byKey.body.data.every((e: { nodeId: string }) => e.nodeId === stepOneNode.id),
      ).toBe(true);
    }

    // Unknown key returns empty list, not 500
    const unknown = await request(ctx.app).get(
      `/api/runs/${runId}/events?nodeId=no-such-node`,
    );
    expect(unknown.status).toBe(200);
    expect(Array.isArray(unknown.body.data)).toBe(true);
    expect(unknown.body.data.length).toBe(0);
  });
});
