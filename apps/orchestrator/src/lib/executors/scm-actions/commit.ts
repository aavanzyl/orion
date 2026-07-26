import { renderTemplate } from '@orion/config';
import type { ScmAction } from './types.js';

/**
 * `commit`: stage and commit any pending changes in every repo of the workspace.
 *
 * Config keys (from `ctx.nodeConfig.config`):
 * - `message` (string, required, templated) — the commit message.
 */
export const commit: ScmAction = async (ctx, { scm }) => {
  const config = (ctx.nodeConfig.config ?? {}) as Record<string, unknown>;

  const message =
    typeof config.message === 'string' && config.message.length > 0
      ? renderTemplate(config.message, {}, ctx.nodeOutputs)
      : undefined;

  if (!message) {
    return { status: 'failed', error: 'commit requires a non-empty "message"' };
  }

  try {
    const committed: string[] = [];

    for (const repo of ctx.workspace.repos) {
      if (!(await scm.hasChanges(repo.path))) {
        await ctx.emit('log', { message: `No changes in ${repo.name}; skipping commit` });
        continue;
      }
      await scm.commitAll(repo.path, message);
      await ctx.emit('log', { message: `Committed changes in ${repo.name}` });
      committed.push(repo.name);
    }

    if (committed.length === 0) {
      return { status: 'completed', output: { message: 'No changes to commit' } };
    }
    return { status: 'completed', output: { message, repos: committed } };
  } catch (err) {
    return {
      status: 'failed',
      error: `commit failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
