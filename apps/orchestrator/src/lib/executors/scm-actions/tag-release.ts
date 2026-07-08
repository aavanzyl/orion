import { renderTemplate } from '@orion/config';
import type { Release } from '@orion/scm-core';
import type { ScmAction } from './types.js';

/**
 * `tag_release`: create a git tag on the current commit of each targeted repo
 * and (when a hosted provider supports it and `config.release` is set) publish
 * a release from that tag.
 *
 * Config keys (from `ctx.nodeConfig.config`):
 * - `tag` (string, required, templated) — tag name, e.g. `v1.2.3`.
 * - `message?` (string, templated) — annotated-tag / release-notes fallback.
 * - `name?` (string, templated) — hosted release name.
 * - `body?` (string, templated) — hosted release notes.
 * - `ref?` (string) — commit-ish the tag points at (defaults to HEAD).
 * - `release?` (boolean) — when true, also publish a hosted release.
 * - `draft?` / `prerelease?` (boolean) — hosted release flags.
 * - `repo?` (string) — target a single repo by name (default: all repos).
 */
export const tagRelease: ScmAction = async (ctx, { scm }) => {
  const config = (ctx.nodeConfig.config ?? {}) as Record<string, unknown>;

  const render = (value: unknown): string | undefined =>
    typeof value === 'string' ? renderTemplate(value, {}, ctx.nodeOutputs) : undefined;

  const tag = render(config.tag);
  if (!tag) {
    return { status: 'failed', error: 'tag_release requires a non-empty "tag"' };
  }

  if (typeof scm.createTag !== 'function') {
    return { status: 'failed', error: 'scm provider does not support tagging' };
  }

  const message = render(config.message);
  const name = render(config.name);
  const body = render(config.body);
  const ref = typeof config.ref === 'string' ? config.ref : undefined;
  const wantsRelease = config.release === true;
  const draft = typeof config.draft === 'boolean' ? config.draft : undefined;
  const prerelease = typeof config.prerelease === 'boolean' ? config.prerelease : undefined;
  const repoFilter = typeof config.repo === 'string' ? config.repo : undefined;

  const targets = repoFilter
    ? ctx.workspace.repos.filter((repo) => repo.name === repoFilter)
    : ctx.workspace.repos;

  if (targets.length === 0) {
    return {
      status: 'failed',
      error: repoFilter
        ? `tag_release: no repo named "${repoFilter}" in the workspace`
        : 'tag_release: no repos in the workspace',
    };
  }

  try {
    const repos: string[] = [];
    const releases: Array<{ repo: string; release: Release }> = [];

    for (const repo of targets) {
      await scm.createTag(repo.path, { tag, message, ref });
      await ctx.emit('log', { message: `Tagged ${repo.name} with ${tag}` });
      repos.push(repo.name);

      if (wantsRelease) {
        if (typeof scm.createRelease !== 'function') {
          return { status: 'failed', error: 'scm provider does not support releases' };
        }
        const release = await scm.createRelease(repo.originPath, {
          tag,
          name,
          body: body ?? message,
          target: ref,
          draft,
          prerelease,
        });
        await ctx.emit('log', { message: `Published release for ${repo.name}: ${release.url}` });
        releases.push({ repo: repo.name, release });
      }
    }

    return {
      status: 'completed',
      output: wantsRelease ? { tag, repos, releases } : { tag, repos },
    };
  } catch (err) {
    return {
      status: 'failed',
      error: `tag_release failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
