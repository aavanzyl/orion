import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import { ShellNodeExecutor } from './shell.executor.js';

function makeCtx(
  script: string | undefined,
  rootPath: string,
  matrix?: NodeExecutionContext['matrix'],
  nodeOutputs: Record<string, unknown> = {},
): { ctx: NodeExecutionContext; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn(async () => undefined);
  const ctx = {
    nodeConfig: { id: 'sh', type: 'shell', script },
    workspace: { rootPath, configRoot: rootPath, repos: [] },
    nodeOutputs,
    emit,
    matrix,
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

  it('runs a non-matrix script and returns stdout', async () => {
    const { ctx, emit } = makeCtx('echo hello', cwd);
    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect((outcome.output as { stdout: string }).stdout).toContain('hello');
    }
    expect(emit).toHaveBeenCalledWith('log', expect.objectContaining({ stdout: expect.stringContaining('hello') }));
  });

  it('exposes the matrix item under the `as` name as $FILE', async () => {
    const { ctx } = makeCtx('echo $FILE', cwd, { item: 'a.ts', index: 0, total: 2, as: 'file' });
    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect((outcome.output as { stdout: string }).stdout).toContain('a.ts');
    }
  });

  it('renders {{ matrix.file }} scope for the `as` name', async () => {
    const { ctx } = makeCtx('echo {{ matrix.file }}', cwd, {
      item: 'a.ts',
      index: 0,
      total: 2,
      as: 'file',
    });
    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect((outcome.output as { stdout: string }).stdout).toContain('a.ts');
    }
  });

  it('keeps backward-compatible $MATRIX_ITEM and {{ matrix.item }}', async () => {
    const { ctx } = makeCtx('echo $MATRIX_ITEM {{ matrix.item }}', cwd, {
      item: 'b.ts',
      index: 1,
      total: 2,
      as: 'file',
    });
    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      const stdout = (outcome.output as { stdout: string }).stdout;
      expect(stdout).toContain('b.ts');
      expect(stdout.match(/b\.ts/g)).toHaveLength(2);
    }
  });

  it('defaults the `as` name to item, exposing $ITEM', async () => {
    const { ctx } = makeCtx('echo $ITEM', cwd, { item: 'c.ts', index: 0, total: 1 });
    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect((outcome.output as { stdout: string }).stdout).toContain('c.ts');
    }
  });

  it('returns failed when the command exits non-zero', async () => {
    const { ctx } = makeCtx('exit 3', cwd);
    const outcome = await executor.execute(ctx);
    expect(outcome.status).toBe('failed');
  });
});
