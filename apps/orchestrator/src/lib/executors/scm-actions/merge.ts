import type { MergeMethod } from '@orion/scm-core';
import type { NodeExecutionContext } from '@orion/workflow-engine';
import type { ScmAction } from './types.js';

/** Shape of an upstream `open_pull_request` node output we can mine for a PR number. */
interface OpenPullRequestOutput {
  pullRequests: Array<{ repo: string; pr: { url: string; number?: number } }>;
}

function isOpenPullRequestOutput(value: unknown): value is OpenPullRequestOutput {
  if (typeof value !== 'object' || value === null) return false;
  const prs = (value as { pullRequests?: unknown }).pullRequests;
  if (!Array.isArray(prs)) return false;
  return prs.every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { repo?: unknown }).repo === 'string' &&
      typeof (entry as { pr?: unknown }).pr === 'object' &&
      (entry as { pr: unknown }).pr !== null,
  );
}

/**
 * Resolve the pull-request number to merge:
 * (a) `ctx.nodeConfig.config.pr` when it is a number; otherwise
 * (b) the first `pr.number` found in an upstream `open_pull_request` node
 *     output (`{ pullRequests: [{ repo, pr: { url, number } }] }`) in
 *     `ctx.nodeOutputs`.
 */
function resolvePrNumber(ctx: NodeExecutionContext): number | undefined {
  const configPr = ctx.nodeConfig.config?.pr;
  if (typeof configPr === 'number') return configPr;

  for (const output of Object.values(ctx.nodeOutputs)) {
    if (isOpenPullRequestOutput(output)) {
      for (const { pr } of output.pullRequests) {
        if (typeof pr.number === 'number') return pr.number;
      }
    }
  }
  return undefined;
}

/**
 * `merge`: merge a pull request opened earlier in the run. The PR number comes
 * from `config.pr` or an upstream `open_pull_request` node output.
 */
export const merge: ScmAction = async (ctx, { scm }) => {
  try {
    if (!scm.mergePullRequest) {
      return { status: 'failed', error: 'scm provider does not support merging' };
    }

    const number = resolvePrNumber(ctx);
    if (number === undefined) {
      return { status: 'failed', error: 'merge: could not resolve a pull request number' };
    }

    const repo = ctx.workspace.repos[0];
    if (!repo) {
      return { status: 'failed', error: 'merge: no repository in workspace' };
    }

    const config = ctx.nodeConfig.config ?? {};
    const method = (config.method as MergeMethod | undefined) ?? 'merge';
    const commitTitle = config.commitTitle as string | undefined;
    const commitMessage = config.commitMessage as string | undefined;

    const result = await scm.mergePullRequest(repo.originPath, {
      number,
      method,
      commitTitle,
      commitMessage,
    });

    if (!result.merged) {
      return { status: 'failed', error: result.message ?? `merge: pull request #${number} was not merged` };
    }

    await ctx.emit('log', { message: `Merged pull request #${number} (${method})` });
    return { status: 'completed', output: { merged: result.merged, sha: result.sha, number } };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
};
