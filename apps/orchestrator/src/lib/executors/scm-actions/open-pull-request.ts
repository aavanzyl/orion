import { renderTemplate } from '@orion/config';
import type { PullRequest } from '@orion/scm-core';
import type { ScmAction } from './types.js';

const PR_PROMPT = (ticketTitle: string, guidance: string | undefined) =>
  `Draft a pull request title and description for the changes in this repository, which implement the ticket "${ticketTitle}". Base it on the actual diff.\n\nRespond with the title on the first line, then a blank line, then the description in Markdown. Do not include any other preamble.${
    guidance ? `\n\nAdditional guidance:\n${guidance}` : ''
  }`;

/** Split an agent response into a title (first line) and body (the rest). */
function splitTitleAndBody(text: string): { title: string; body: string } {
  const trimmed = text.trim();
  const newline = trimmed.indexOf('\n');
  if (newline === -1) return { title: trimmed, body: '' };
  return {
    title: trimmed.slice(0, newline).trim().replace(/^#+\s*/, ''),
    body: trimmed.slice(newline + 1).trim(),
  };
}

/**
 * `open_pull_request`: commit any pending changes, push, and open a PR per
 * repository that is ahead of its base branch. All defaults can be overridden
 * via `config` keys:
 *  - `title` (string, templated) — PR title override
 *  - `body` (string, templated)  — PR description override
 *  - `base` (string)              — target branch override
 *
 * When the node sets `agentGenerated`, a harness turn drafts the title and body
 * from the run's changes; the static `config.title`/`config.body` become
 * optional guidance for that draft.
 */
export const openPullRequest: ScmAction = async (ctx, { scm, tickets, agentText }) => {
  const config = (ctx.nodeConfig.config ?? {}) as Record<string, unknown>;
  const ticket = await tickets.get(ctx.ticketId);
  const ticketTitle = ticket ? ticket.title : `Orion run ${ctx.run.id}`;
  const defaultBase = ctx.workspace.repos[0]?.baseBranch;

  let prTitle: string;
  let prBody: string;

  if (ctx.nodeConfig.agentGenerated) {
    const guidance = [
      typeof config.title === 'string' ? config.title : undefined,
      typeof config.body === 'string' ? config.body : undefined,
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      const drafted = await agentText.generate({
        prompt: PR_PROMPT(ticketTitle, guidance || undefined),
        workingDirectory: ctx.workspace.rootPath,
        provider: ctx.nodeConfig.provider,
        model: ctx.nodeConfig.model,
        signal: ctx.signal,
      });
      const parsed = splitTitleAndBody(drafted);
      prTitle = parsed.title || `Orion: ${ticketTitle}`;
      prBody = parsed.body || (ticket?.description ?? '');
    } catch (err) {
      return {
        status: 'failed',
        error: `pull request drafting failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else {
    prTitle =
      typeof config.title === 'string' && config.title.length > 0
        ? renderTemplate(config.title, {}, ctx.nodeOutputs)
        : `Orion: ${ticketTitle}`;
    prBody =
      typeof config.body === 'string' && config.body.length > 0
        ? renderTemplate(config.body, {}, ctx.nodeOutputs)
        : (ticket?.description ?? '');
  }

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
