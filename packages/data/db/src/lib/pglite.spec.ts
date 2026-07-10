import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  type DbHandle,
  ProjectRepository,
  ProviderRepository,
  RagRepository,
  RunRepository,
  runMigrations,
  TicketRepository,
  ScheduleRepository,
} from '../index.js';
describe('embedded PGlite database', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = createDb('pglite://memory');
    await runMigrations(handle);
  });

  afterAll(async () => {
    await handle.close();
  });

  it('detects the pglite dialect', () => {
    expect(handle.dialect).toBe('pglite');
  });

  it('round-trips a project through the repository', async () => {
    const projects = new ProjectRepository(handle.db);
    const created = await projects.create({
      name: 'demo',
      sourceKind: 'local',
      rootPath: '/tmp/demo',
    });

    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.name).toBe('demo');
    expect(created.sourceKind).toBe('local');
    expect(created.rootPath).toBe('/tmp/demo');
    expect(typeof created.createdAt).toBe('string');
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);

    const fetched = await projects.get(created.id);
    expect(fetched?.name).toBe('demo');

    const all = await projects.list();
    expect(all.map((p) => p.id)).toContain(created.id);
  });

  it('round-trips a jsonb array column on a provider', async () => {
    const providers = new ProviderRepository(handle.db);
    const created = await providers.create({ key: 'openai', harness: 'codex', models: ['a', 'b'] });

    expect(created.models).toEqual(['a', 'b']);
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);

    const fetched = await providers.get(created.id);
    expect(fetched?.models).toEqual(['a', 'b']);
  });

  it('covers FKs and a jsonb dependsOn through a ticket and run', async () => {
    const projects = new ProjectRepository(handle.db);
    const tickets = new TicketRepository(handle.db);
    const runs = new RunRepository(handle.db);

    const project = await projects.create({ name: 'fk', sourceKind: 'local', rootPath: '/tmp/fk' });
    const ticket = await tickets.create({
      projectId: project.id,
      title: 'do work',
      swimlane: 'todo',
    });

    const run = await runs.create({
      ticketId: ticket.id,
      projectId: project.id,
      workflowName: 'default',
    });
    expect(run.status).toBe('created');

    const node = await runs.createNode({
      runId: run.id,
      nodeKey: 'plan',
      type: 'agent',
      dependsOn: ['root'],
    });
    expect(node.dependsOn).toEqual(['root']);

    const nodes = await runs.listNodes(run.id);
    expect(nodes).toHaveLength(1);
  });

  it('round-trips schedules, including selection lists and fire bookkeeping', async () => {
    const projects = new ProjectRepository(handle.db);
    const schedules = new ScheduleRepository(handle.db);

    const project = await projects.create({
      name: 'schedules',
      sourceKind: 'local',
      rootPath: '/tmp/schedules',
    });

    const nightly = await schedules.create({
      projectId: project.id,
      name: 'nightly',
      cron: '0 9 * * *',
      instruction: 'Review the board and file follow-up tickets.',
      skills: ['conventional-commits'],
      mcpServers: ['github'],
      mcpServerConfigs: { github: { url: 'https://api.githubcopilot.com/mcp/' } },
      nextFireAt: new Date('2030-01-01T09:00:00Z'),
    });
    expect(nightly.enabled).toBe(true);
    expect(nightly.nextFireAt).toBe('2030-01-01T09:00:00.000Z');
    expect(nightly.instruction).toContain('follow-up tickets');
    expect(nightly.skills).toEqual(['conventional-commits']);
    expect(nightly.mcpServers).toEqual(['github']);
    expect(nightly.mcpServerConfigs).toEqual({
      github: { url: 'https://api.githubcopilot.com/mcp/' },
    });

    const other = await schedules.create({
      projectId: project.id,
      name: 'weekly',
      cron: '0 9 * * 1',
      instruction: 'Summarize the week.',
      nextFireAt: new Date('2030-01-06T09:00:00Z'),
    });
    expect(other.skills).toEqual([]);
    expect(other.mcpServers).toEqual([]);
    expect(other.mcpServerConfigs).toEqual({});

    const list = await schedules.list(project.id);
    expect(list.map((s) => s.id)).toEqual(expect.arrayContaining([nightly.id, other.id]));

    const enabled = await schedules.listAllEnabled();
    expect(enabled.map((s: { id: string }) => s.id)).toEqual(
      expect.arrayContaining([nightly.id, other.id]),
    );

    const fired = await schedules.markFired(
      nightly.id,
      new Date('2030-01-01T09:00:00Z'),
      new Date('2030-01-02T09:00:00Z'),
    );
    expect(fired?.lastFiredAt).toBe('2030-01-01T09:00:00.000Z');
    expect(fired?.nextFireAt).toBe('2030-01-02T09:00:00.000Z');

    const disabled = await schedules.update(other.id, { enabled: false });
    expect(disabled?.enabled).toBe(false);
    expect((await schedules.listAllEnabled()).map((s: { id: string }) => s.id)).not.toContain(
      other.id,
    );

    await schedules.delete(nightly.id);
    expect(await schedules.get(nightly.id)).toBeNull();
  });

  it('round-trips a code index and jsonb embedding chunks', async () => {
    const projects = new ProjectRepository(handle.db);
    const rag = new RagRepository(handle.db);

    const project = await projects.create({
      name: 'rag',
      sourceKind: 'local',
      rootPath: '/tmp/rag',
    });

    expect(await rag.getIndex(project.id)).toBeNull();

    const indexing = await rag.upsertIndex(project.id, { status: 'indexing' });
    expect(indexing.status).toBe('indexing');

    await rag.insertChunks([
      {
        projectId: project.id,
        filePath: 'src/a.ts',
        chunkIndex: 0,
        startLine: 1,
        endLine: 10,
        content: 'export const a = 1;',
        embedding: [0.1, 0.2, 0.3],
      },
      {
        projectId: project.id,
        filePath: 'src/b.ts',
        chunkIndex: 0,
        startLine: 1,
        endLine: 5,
        content: 'export const b = 2;',
        embedding: [0.4, 0.5, 0.6],
      },
    ]);

    const chunks = await rag.listChunks(project.id);
    expect(chunks).toHaveLength(2);
    const a = chunks.find((c) => c.filePath === 'src/a.ts');
    expect(a?.embedding).toEqual([0.1, 0.2, 0.3]);

    const ready = await rag.upsertIndex(project.id, {
      status: 'ready',
      provider: 'local',
      dimensions: 256,
      fileCount: 2,
      chunkCount: 2,
      lastIndexedAt: new Date('2030-01-01T00:00:00Z'),
    });
    expect(ready.status).toBe('ready');
    expect(ready.provider).toBe('local');
    expect(ready.chunkCount).toBe(2);
    expect(ready.lastIndexedAt).toBe('2030-01-01T00:00:00.000Z');

    await rag.clearChunks(project.id);
    expect(await rag.listChunks(project.id)).toHaveLength(0);
  });
});