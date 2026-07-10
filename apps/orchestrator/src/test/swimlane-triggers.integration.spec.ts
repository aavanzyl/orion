import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedProjectRepo, type TestApp } from './app.js';

const CONFIG_WITH_SWIMLANE_TRIGGERS = `project:
  name: swimlane-project
  defaultBranch: main

board:
  swimlanes: [backlog, triage, in_progress, done]

workflows:
  triage-flow:
    name: triage-flow
    nodes:
      - id: assess
        type: approval
        swimlane: triage

workflow:
  name: default
  nodes:
    - id: implement
      type: agent
      provider: codex
      model: gpt-5-codex
      swimlane: in_progress
`;

describe('swimlane triggers (integration)', () => {
  let ctx: TestApp;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const rootPath = await seedProjectRepo({}, CONFIG_WITH_SWIMLANE_TRIGGERS);
    const project = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'Swimlane Project', sourceKind: 'local', rootPath });
    projectId = project.body.data.id;
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  async function createTicket(): Promise<string> {
    const res = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'Do the thing', swimlane: 'backlog' });
    return res.body.data.id;
  }

  it('starts the swimlane workflow when a ticket enters a trigger column', async () => {
    const ticketId = await createTicket();

    await ctx.runs.handleSwimlaneEntry(ticketId, 'triage');

    const runs = await ctx.runs.listRunsForTicket(ticketId);
    expect(runs).toHaveLength(1);
    expect(runs[0].workflowName).toBe('triage-flow');
  });

  it('does not start a workflow when a ticket enters a column with no trigger', async () => {
    const ticketId = await createTicket();

    await ctx.runs.handleSwimlaneEntry(ticketId, 'backlog');

    const runs = await ctx.runs.listRunsForTicket(ticketId);
    expect(runs).toHaveLength(0);
  });
});
