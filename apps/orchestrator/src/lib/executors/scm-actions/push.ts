import { renderTemplate } from '@orion/config';
import type { ScmAction } from './types.js';

/**
 * `push`: push the current branch to the remote in every repo of the workspace.
 *
 * Config keys (from `ctx.nodeConfig.config`):
 * - `branch` (string, optional, templated) — branch name to push (defaults to the repo's branch).
 */
export const push: ScmAction = async (ctx, { scm }) => {
  const config = (ctx.nodeConfig.config ?? {}) as Record<string, unknown>;

  const branchOverride =
    typeof config.branch === 'string' && config.branch.length > 0
      ? renderTemplate(config.branch, {}, ctx.nodeOutputs)
      : undefined;

  try {
    const pushed: string[] = [];

    for (const repo of ctx.workspace.repos) {
      const branch = branchOverride ?? repo.branch;
      await scm.push(repo.path, branch);
      await ctx.emit('log', { message: `Pushed ${repo.name}:${branch}` });
      pushed.push(repo.name);
    }

    return { status: 'completed', output: { repos: pushed } };
  } catch (err) {
    return {
      status: 'failed',
      error: `push failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
