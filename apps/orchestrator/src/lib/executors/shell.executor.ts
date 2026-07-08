import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderTemplate } from '@orion/config';
import type { NodeExecutor, NodeExecutionContext, NodeOutcome } from '@orion/workflow-engine';

const execFileAsync = promisify(execFile);

/** Executes a `shell` node: runs a command in the run's worktree. */
export class ShellNodeExecutor implements NodeExecutor {
  readonly type = 'shell' as const;

  async execute(ctx: NodeExecutionContext): Promise<NodeOutcome> {
    const rawScript = ctx.nodeConfig.script;
    if (!rawScript) {
      return { status: 'failed', error: 'shell node has no script' };
    }
    const variables: Record<string, string> = {};
    let scope: Record<string, unknown> | undefined;
    if (ctx.matrix) {
      const itemStr =
        typeof ctx.matrix.item === 'string' ? ctx.matrix.item : JSON.stringify(ctx.matrix.item);
      const name = ctx.matrix.as ?? 'item';
      scope = {
        matrix: {
          item: ctx.matrix.item,
          index: ctx.matrix.index,
          total: ctx.matrix.total,
          [name]: ctx.matrix.item,
        },
      };
      variables.MATRIX_ITEM = itemStr;
      variables.MATRIX_INDEX = String(ctx.matrix.index);
      variables.MATRIX_TOTAL = String(ctx.matrix.total);
      variables[name.toUpperCase()] = itemStr;
    }
    const script = renderTemplate(rawScript, variables, ctx.nodeOutputs, scope);
    try {
      const { stdout, stderr } = await execFileAsync('sh', ['-c', script], {
        cwd: ctx.workspace.rootPath,
        maxBuffer: 1024 * 1024 * 32,
        signal: ctx.signal,
      });
      await ctx.emit('log', { script, stdout, stderr });
      return { status: 'completed', output: { stdout, stderr } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.emit('log', { script, error: message });
      return { status: 'failed', error: message };
    }
  }
}
