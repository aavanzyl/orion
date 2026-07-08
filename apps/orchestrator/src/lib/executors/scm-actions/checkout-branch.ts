import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderTemplate } from '@orion/config';
import type { ScmAction } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * `checkout_branch`: create and switch to the run's branch in every repo of the
 * workspace. When `config.branchFormat` is set it overrides the project-wide
 * branch template and is rendered with ticket/run variables.
 */
export const checkoutBranch: ScmAction = async (ctx) => {
  const config = (ctx.nodeConfig.config ?? {}) as Record<string, unknown>;

  // Branch template override via config.branchFormat; falls back to the
  // branch already created during run setup (workspace.repos[0].branch).
  let branch = ctx.workspace.repos[0]?.branch;
  if (typeof config.branchFormat === 'string' && config.branchFormat.length > 0) {
    branch = renderTemplate(config.branchFormat, {}, ctx.nodeOutputs);
  }
  if (!branch) {
    return { status: 'failed', error: 'No branch name available for checkout' };
  }

  try {
    await ctx.emit('log', { message: `Checking out branch ${branch}` });
    for (const repo of ctx.workspace.repos) {
      const existing = await execFileAsync('git', ['rev-parse', '--verify', branch], {
        cwd: repo.path,
      })
        .then(() => true)
        .catch(() => false);

      if (existing) {
        await execFileAsync('git', ['checkout', branch], { cwd: repo.path });
      } else {
        await execFileAsync('git', ['checkout', '-b', branch], { cwd: repo.path });
      }
    }
    return { status: 'completed', output: { branch } };
  } catch (err) {
    return {
      status: 'failed',
      error: `checkout_branch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
