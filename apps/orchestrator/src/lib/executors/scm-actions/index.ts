import type { ScmAction } from './types.js';
import { checkoutBranch } from './checkout-branch.js';
import { commit } from './commit.js';
import { openPullRequest } from './open-pull-request.js';
import { push } from './push.js';
import { tagRelease } from './tag-release.js';
import { merge } from './merge.js';
import { review } from './review.js';

/**
 * Registry of supported `scm` node actions, keyed by canonical action name.
 * The {@link ScmNodeExecutor} dispatches `nodeConfig.action` through this map.
 */
export const SCM_ACTIONS: Record<string, ScmAction> = {
  checkout_branch: checkoutBranch,
  commit: commit,
  open_pull_request: openPullRequest,
  push: push,
  tag_release: tagRelease,
  merge: merge,
  review: review,
};

export * from './types.js';
