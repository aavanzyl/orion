import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import { ShellNodeExecutor } from './shell.executor.js';

function makeCtx(
  script: string | undefined,
  rootPath: string,
  nodeOutputs: Record<string, unknown> = {},
): { ctx: NodeExecutionContext; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn(async () => undefined);
  const ctx = {
    nodeConfig: { id: 'sh', type: 'shell', script },
    workspace: { rootPath, configRoot: rootPath, repos: [] },
    nodeOutputs,
    emit,
  } as unknown as NodeExecutionContext;
  return { ctx, emit };
}

describe('ShellNodeExecutor', () => {
  const executor = new ShellNodeExecutor();
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'orion-shell-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('fails when the node has no script', async () => {
    const { ctx } = makeCtx(undefined, cwd);
    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('failed');
  });

  it('runs a script and returns stdout', async () => {
    const { ctx, emit } = makeCtx('echo hello', cwd);
    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect((outcome.output as { stdout: string }).stdout).toContain('hello');
    }
    expect(emit).toHaveBeenCalledWith('log', expect.objectContaining({ stdout: expect.stringContaining('hello') }));
  });

  it('returns failed when the command exits non-zero', async () => {
    const { ctx } = makeCtx('exit 3', cwd);
    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('failed');
  });
});
