import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Project } from '@orion/models';
import type { RepoRef, ScmProvider, WorktreeHandle } from '@orion/scm-core';
import type { RunWorkspace, RunWorkspaceRepo } from '@orion/workflow-engine';
import type { Container } from '../container.js';

interface Member {
  name: string;
  ref: RepoRef;
}

export interface PreparedWorkspace {
  workspace: RunWorkspace;
  cleanup: () => Promise<void>;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';
}

async function isGitRepo(path: string): Promise<boolean> {
  try {
    return (await stat(join(path, '.git'))).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Turns a project (remote repo, local repo, or local parent folder of repos)
 * into an isolated workspace for a run, and resolves where its config lives.
 */
export class WorkspaceService {
  constructor(private readonly c: Container) {}

  private scm(project: Project): ScmProvider {
    return this.c.scm.get(project.scmProvider);
  }

  /** Discover the member repositories that make up a project. */
  async members(project: Project): Promise<Member[]> {
    if (project.sourceKind === 'remote') {
      return [{ name: sanitize(project.name), ref: { url: project.repoUrl } }];
    }
    if (!project.rootPath) {
      throw new Error(`Project "${project.name}" has no rootPath`);
    }
    if (project.sourceKind === 'local') {
      return [{ name: sanitize(basename(project.rootPath)), ref: { path: project.rootPath } }];
    }
    // workspace: every immediate subdirectory that is a git repo.
    const entries = await readdir(project.rootPath, { withFileTypes: true });
    const members: Member[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(project.rootPath, entry.name);
      if (await isGitRepo(path)) {
        members.push({ name: sanitize(entry.name), ref: { path } });
      }
    }
    if (members.length === 0) {
      throw new Error(`No git repositories found under "${project.rootPath}"`);
    }
    return members;
  }

  /** The directory that contains this project's `.orion` config. */
  async resolveConfigRoot(project: Project): Promise<string> {
    if (project.sourceKind === 'remote') {
      return this.scm(project).resolveRepo(
        { url: project.repoUrl },
        { workspaceDir: this.c.env.workspaceDir },
      );
    }
    if (!project.rootPath) {
      throw new Error(`Project "${project.name}" has no rootPath`);
    }
    return project.rootPath;
  }

  /** Prepare isolated worktrees for a run. */
  async prepare(project: Project, runId: string, branch: string): Promise<PreparedWorkspace> {
    const scm = this.scm(project);
    const members = await this.members(project);
    const multi = members.length > 1;
    // Worktrees always live under the managed workspace volume so the source
    // repositories (which may be the user's own local checkouts) stay untouched.
    const runDir = join(this.c.env.workspaceDir, 'runs', runId);

    const handles: WorktreeHandle[] = [];
    const repos: RunWorkspaceRepo[] = [];

    for (const member of members) {
      const originPath = await scm.resolveRepo(member.ref, {
        workspaceDir: this.c.env.workspaceDir,
      });
      const baseBranch = await scm.getDefaultBranch(originPath);
      const base = member.ref.url ? `origin/${baseBranch}` : 'HEAD';
      const worktree = await scm.createWorktree(originPath, {
        branch,
        base,
        worktreePath: join(runDir, member.name),
      });
      handles.push(worktree);
      repos.push({
        name: member.name,
        path: worktree.path,
        originPath,
        branch,
        baseBranch,
      });
    }

    const rootPath = multi ? runDir : repos[0].path;
    const configRoot =
      project.sourceKind === 'workspace' ? (project.rootPath as string) : repos[0].path;

    return {
      workspace: { rootPath, configRoot, repos },
      cleanup: async () => {
        for (const handle of handles) {
          await handle.cleanup().catch(() => undefined);
        }
      },
    };
  }
}
