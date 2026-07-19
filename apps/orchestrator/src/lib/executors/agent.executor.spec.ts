import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HarnessRegistry } from '@orion/harness-core';
import type { AgentProvider } from '@orion/harness-core';
import type { ProviderRepository, TicketRepository } from '@orion/db';
import type { OrionEnv } from '../env.js';
import { AgentNodeExecutor } from './agent.executor.js';
import type { NodeExecutionContext, RunWorkspace } from '@orion/workflow-engine';
import type { WorkflowNodeConfig, WorkflowRun } from '@orion/models';

function makeEnv(overrides?: Partial<OrionEnv>): OrionEnv {
  return {
    host: 'localhost',
    port: 0,
    databaseUrl: 'pglite://memory',
    workspaceDir: '/tmp/ws',
    projectsDir: '/tmp/projects',
    maxConcurrentRuns: 0,
    publicUrl: 'http://localhost:0',
    codebaseMcpEnabled: false,
    boardSyncIntervalMs: 600000,
    ...overrides,
  };
}

function makeFakeHarness(key: string): AgentProvider {
  return {
    key,
    run: vi.fn().mockResolvedValue({ finalResponse: 'result' }),
    runStreamed: vi.fn().mockReturnValue(
      (async function* () {
        yield { type: 'completed' as const, result: { finalResponse: 'done', threadId: 'th1', usage: {} } };
      })(),
    ),
  };
}

function makeCtx(
  nodeConfig: Partial<WorkflowNodeConfig>,
  configRoot: string,
): NodeExecutionContext {
  const workspace: RunWorkspace = {
    rootPath: configRoot,
    configRoot,
    repos: [{ name: 'test', path: configRoot, originPath: configRoot, branch: 'main', baseBranch: 'main' }],
  };
  return {
    run: { id: 'r1', projectId: 'p1', threadId: undefined } as WorkflowRun,
    node: { id: 'n1', nodeId: 'agent1', type: 'agent', status: 'running' } as any,
    nodeConfig: { id: 'agent1', type: 'agent', ...nodeConfig } as WorkflowNodeConfig,
    config: {
      project: { name: 'Test', defaultBranch: 'main' },
      mcpServers: {},
    } as any,
    workspace,
    ticketId: 't1',
    emit: vi.fn(async () => undefined),
    nodeOutputs: {},
  };
}

describe('AgentNodeExecutor – instructions resolution', () => {
  let harnesses: HarnessRegistry;
  let fakeHarness: AgentProvider;
  let tickets: TicketRepository;
  let providers: ProviderRepository;
  let configRoot: string;

  beforeEach(() => {
    harnesses = new HarnessRegistry();
    fakeHarness = makeFakeHarness('codex');
    harnesses.register(fakeHarness);
    tickets = {
      get: vi.fn().mockResolvedValue({
        id: 't1',
        projectId: 'p1',
        title: 'Fix bug',
        description: 'It broke',
        source: 'native',
        externalId: null,
        swimlane: 'backlog',
      }),
      getByExternal: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    } as unknown as TicketRepository;
    providers = {
      list: vi.fn().mockResolvedValue([]),
      getApiKey: vi.fn().mockResolvedValue(null),
    } as unknown as ProviderRepository;
    configRoot = mkdtempSync(join(tmpdir(), 'agent-executor-test-'));
  });

  afterEach(() => {
    try { rmSync(configRoot, { recursive: true, force: true }); } catch { /* cleanup best effort */ }
  });

  it('fails when instructions look like a file path but the file is missing', async () => {
    const executor = new AgentNodeExecutor(harnesses, tickets, providers, makeEnv());
    const ctx = makeCtx({ instructions: 'instructions/investigate.md', provider: 'codex' }, configRoot);

    const outcome = await executor.execute(ctx);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toContain('instructions file "instructions/investigate.md" not found');
    }
  });

  it('fails when instructions end with .md but file is missing', async () => {
    const executor = new AgentNodeExecutor(harnesses, tickets, providers, makeEnv());
    const ctx = makeCtx({ instructions: 'investigate.md', provider: 'codex' }, configRoot);

    const outcome = await executor.execute(ctx);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toContain('instructions file "investigate.md" not found');
    }
  });

  it('fails when instructions start with ./ but file is missing', async () => {
    const executor = new AgentNodeExecutor(harnesses, tickets, providers, makeEnv());
    const ctx = makeCtx({ instructions: './prompts/run.md', provider: 'codex' }, configRoot);

    const outcome = await executor.execute(ctx);

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toContain('instructions file "./prompts/run.md" not found');
    }
  });

  it('renders non-path single-line instructions as inline template', async () => {
    const executor = new AgentNodeExecutor(harnesses, tickets, providers, makeEnv());
    const ctx = makeCtx({ instructions: 'Solve: $TICKET_TITLE', provider: 'codex' }, configRoot);

    const outcome = await executor.execute(ctx);

    expect(outcome.status).toBe('completed');
    expect(fakeHarness.runStreamed).toHaveBeenCalledWith(
      expect.stringContaining('Solve: Fix bug'),
      expect.anything(),
    );
  });

  it('executes multi-line instructions as inline template', async () => {
    const executor = new AgentNodeExecutor(harnesses, tickets, providers, makeEnv());
    const ctx = makeCtx({ instructions: 'You are an expert.\n\nTicket: $TICKET_TITLE', provider: 'codex' }, configRoot);

    const outcome = await executor.execute(ctx);

    expect(outcome.status).toBe('completed');
    expect(fakeHarness.runStreamed).toHaveBeenCalledWith(
      expect.stringContaining('Ticket: Fix bug'),
      expect.anything(),
    );
  });

  it('loads and renders instructions from an existing file path', async () => {
    const orionDir = join(configRoot, '.orion');
    const instructionsDir = join(orionDir, 'instructions');
    mkdirSync(instructionsDir, { recursive: true });
    writeFileSync(join(instructionsDir, 'investigate.md'), 'Investigate: $TICKET_TITLE', 'utf8');

    const executor = new AgentNodeExecutor(harnesses, tickets, providers, makeEnv());
    const ctx = makeCtx({ instructions: 'instructions/investigate.md', provider: 'codex' }, configRoot);

    const outcome = await executor.execute(ctx);

    expect(outcome.status).toBe('completed');
    expect(fakeHarness.runStreamed).toHaveBeenCalledWith(
      expect.stringContaining('Investigate: Fix bug'),
      expect.anything(),
    );
  });

  it('re-throws non-ENOENT errors from renderCommand', async () => {
    const executor = new AgentNodeExecutor(harnesses, tickets, providers, makeEnv());
    const ctx = makeCtx({ instructions: '../../../etc/passwd', provider: 'codex' }, configRoot);

    const outcome = await executor.execute(ctx);

    // Path traversal is rejected by resolveCommandPath with ConfigError, which is not ENOENT
    expect(outcome.status).toBe('failed');
  });
});
