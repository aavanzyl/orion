import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, seedProjectRepo, type TestApp } from './app.js';

const CONFIG_WITH_ISSUE_TYPES = `project:
  name: issue-type-project
  defaultBranch: main

board:
  swimlanes: [backlog, in_progress, done]

issueTypes:
  - name: feature
    label: Feature
    workflow: feature-flow
  - name: bug
    label: Bug
    workflow: bug-fix

workflows:
  feature-flow:
    name: feature-flow
    nodes:
      - id: build
        type: shell
        script: 'echo "building feature"'
  bug-fix:
    name: bug-fix
    nodes:
      - id: fix
        type: shell
        script: 'echo "fixing bug"'

workflow:
  name: default
  nodes:
    - id: implement
      type: agent
      provider: codex
      model: gpt-5-codex
      swimlane: in_progress
`;

describe('type-based workflows (integration)', () => {
  let ctx: TestApp;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const rootPath = await seedProjectRepo({}, CONFIG_WITH_ISSUE_TYPES);
    const project = await request(ctx.app)
      .post('/api/projects')
      .send({ name: 'Issue Type Project', sourceKind: 'local', rootPath, config: CONFIG_WITH_ISSUE_TYPES });
    projectId = project.body.data.id;
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('config endpoint includes issueTypes', async () => {
    const res = await request(ctx.app).get(`/api/projects/${projectId}/config`);
    expect(res.status).toBe(200);
    expect(res.body.data.issueTypes).toEqual([
      { name: 'feature', label: 'Feature', workflow: 'feature-flow' },
      { name: 'bug', label: 'Bug', workflow: 'bug-fix' },
    ]);
  });

  it('board endpoint includes issueTypes with epic always present', async () => {
    const res = await request(ctx.app).get(`/api/projects/${projectId}/board`);
    expect(res.status).toBe(200);
    expect(res.body.data.issueTypes).toEqual([
      { value: 'epic', label: 'Epic' },
      { value: 'feature', label: 'Feature', workflow: 'feature-flow' },
      { value: 'bug', label: 'Bug', workflow: 'bug-fix' },
    ]);
  });

  it('creates a ticket with a configured type and shows it on the board', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'A bug fix', type: 'bug', swimlane: 'backlog' });
    expect(created.status).toBe(201);
    expect(created.body.data.type).toBe('bug');

    const board = await request(ctx.app).get(`/api/projects/${projectId}/board`);
    expect(board.status).toBe(200);
    const tickets = board.body.data.swimlanes[0].tickets;
    expect(tickets.some((t: { type: string }) => t.type === 'bug')).toBe(true);
  });

  it('allows epic type always', async () => {
    const created = await request(ctx.app)
      .post(`/api/projects/${projectId}/tickets`)
      .send({ title: 'An epic', type: 'epic', swimlane: 'backlog' });
    expect(created.status).toBe(201);
    expect(created.body.data.type).toBe('epic');
  });
});
