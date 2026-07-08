import { renderTemplate } from '@orion/config';
import type { PullRequest } from '@orion/scm-core';
import type { ScmAction } from './types.js';

/**
 * `open_pull_request`: commit any pending changes, push, and open a PR per
 * repository that is ahead of its base branch. All defaults can be overridden
 * via `config` keys:
 *  - `title` (string, templated) — PR title override
 *  - `body` (string, templated)  — PR description override
 *  - `base` (string)              — target branch override
 */
export const openPullRequest: ScmAction = async (ctx, { scm, tickets }) => {
  const config = (ctx.nodeConfig.config ?? {}) as Record<string, unknown>;
  const ticket = await tickets.get(ctx.ticketId);
  const ticketTitle = ticket ? ticket.title : `Orion run ${ctx.run.id}`;
  const defaultBase = ctx.workspace.repos[0]?.baseBranch;

  const prTitle =
    typeof config.title === 'string' && config.title.length > 0
      ? renderTemplate(config.title, {}, ctx.nodeOutputs)
      : `Orion: ${ticketTitle}`;
  const prBody =
    typeof config.body === 'string' && config.body.length > 0
      ? renderTemplate(config.body, {}, ctx.nodeOutputs)
      : (ticket?.description ?? '');
  const prBase =
    typeof config.base === 'string' && config.base.length > 0
      ? config.base
      : defaultBase;

  const pullRequests: Array<{ repo: string; pr: PullRequest }> = [];

  for (const repo of ctx.workspace.repos) {
    if (await scm.hasChanges(repo.path)) {
      await scm.commitAll(repo.path, `Orion: ${prTitle}`);
    }
    const base = prBase ?? repo.baseBranch;
    if ((await scm.commitsAhead(repo.path, base)) === 0) {
      await ctx.emit('log', { message: `No changes in ${repo.name}; skipping PR` });
      continue;
    }

    await scm.push(repo.path, repo.branch);
    await ctx.emit('log', { message: `Pushed ${repo.name}:${repo.branch}` });

    const pr = await scm.openPullRequest(repo.originPath, {
      title: prTitle,
      body: prBody,
      head: repo.branch,
      base,
    });
    await ctx.emit('log', { message: `Opened pull request for ${repo.name}: ${pr.url}` });
    pullRequests.push({ repo: repo.name, pr });
  }

  if (pullRequests.length === 0) {
    return { status: 'completed', output: { message: 'No changes to open a pull request for' } };
  }
  return { status: 'completed', output: { pullRequests } };
};
