import { loadProjectConfig, resolveTriggerWorkflowForSwimlane } from '@orion/config';
import type { MoveTriggerResult, WorkflowConfig } from '@orion/models';
import { ACTIVE_RUN_STATUSES } from '@orion/models';
import type { Container } from '../container.js';
import type { RunService } from './run.service.js';
import { WorkspaceService } from './workspace.service.js';

/**
 * Evaluates whether moving a ticket into a swimlane should auto-start or
 * resume a workflow run. Used by the move HTTP endpoint, the manual run
 * endpoint, and the board-sync pull loop.
 */
export class TriggerService {
  private readonly workspaces: WorkspaceService;

  constructor(
    private readonly c: Container,
    private readonly runs: RunService,
  ) {
    this.workspaces = new WorkspaceService(c);
  }

  /**
   * Evaluate and execute the trigger policy for a ticket entering a swimlane.
   *
   * Order of checks:
   * 1. **Active run guard** — if the ticket has any active run, reject.
   * 2. **Retry** — if the latest run failed and has a failed node whose
   *    configured `swimlane` matches `destSwimlane`, retry that run.
   * 3. **Start** — if `destSwimlane` matches a start-node's swimlane in the
   *    resolved workflow, start a new run.
   *
   * Returns a result describing what happened so the caller can present the
   * right toast / response body.
   */
  async onTicketEnteredSwimlane(
    ticketId: string,
    destSwimlane: string,
    opts?: { source?: 'move' | 'sync' },
  ): Promise<MoveTriggerResult> {
    const ticket = await this.c.tickets.get(ticketId);
    if (!ticket) return { action: 'none', reason: 'no-trigger' };

    const project = await this.c.projects.get(ticket.projectId);
    if (!project) return { action: 'none', reason: 'no-trigger' };

    const allRuns = await this.c.runs.getByTicket(ticketId);
    const activeRun = allRuns.find((r) => ACTIVE_RUN_STATUSES.has(r.status));
    if (activeRun) {
      return { action: 'none', reason: 'active-run' };
    }

    const config = await this.workspaces
      .resolveConfigRoot(project)
      .then((root) => loadProjectConfig(root, project.configPath));

    // Retry check: latest failed run with a failed node whose swimlane matches.
    const latestRun = allRuns[allRuns.length - 1];
    if (latestRun && latestRun.status === 'failed' && latestRun.configSnapshot?.workflow) {
      try {
        const retryResult = await this.tryRetryOnFailedNode(ticketId, destSwimlane, latestRun.id, latestRun.configSnapshot.workflow);
        if (retryResult.action !== 'none') return retryResult;
        // No matching failed node — fall through to start.
      } catch {
        // Retry may fail if run state is inconsistent; fall through to start.
      }
    }

    const workflowName = resolveTriggerWorkflowForSwimlane(
      config,
      destSwimlane,
      ticket.type,
      ticket.workflowName,
    );

    if (workflowName) {
      try {
        const run = await this.runs.start(ticketId, workflowName, { background: opts?.source === 'sync' });
        return { action: 'started', runId: run.id, workflowName };
      } catch {
        return { action: 'none', reason: 'no-trigger' };
      }
    }

    const reason = opts?.source === 'move' ? this.computeNoTriggerReason(config, destSwimlane) : 'no-trigger';
    return { action: 'none', reason };
  }

  /**
   * Determine *why* a swimlane didn't trigger anything: mid-workflow lane
   * or just no node at all.
   */
  private computeNoTriggerReason(
    config: { workflow: WorkflowConfig; workflows?: Record<string, WorkflowConfig> },
    swimlane: string,
  ): MoveTriggerResult['reason'] {
    for (const wf of [config.workflow, ...Object.values(config.workflows ?? {})]) {
      const nonStart = wf.nodes.filter((n) => (n.dependsOn ?? []).length > 0);
      if (nonStart.some((n) => n.swimlane === swimlane)) {
        return 'mid-workflow-lane';
      }
    }
    return 'no-trigger';
  }

  /**
   * If the latest run has a node in `failed` status whose swimlane matches
   * `destSwimlane`, retry the entire run. All nodes are re-executed against
   * a freshly prepared worktree.
   */
  private async tryRetryOnFailedNode(
    ticketId: string,
    destSwimlane: string,
    runId: string,
    workflow: WorkflowConfig,
  ): Promise<MoveTriggerResult> {
    const nodes = await this.c.runs.listNodes(runId);
    const failedNode = nodes.find((n) => n.status === 'failed');
    if (!failedNode) return { action: 'none', reason: 'no-trigger' };

    const nodeConfig = workflow.nodes.find((nc) => nc.id === failedNode.nodeKey);
    if (!nodeConfig || nodeConfig.swimlane !== destSwimlane) {
      return { action: 'none', reason: 'no-trigger' };
    }

    const run = await this.runs.retry(runId);
    return { action: 'retried', runId: run.id, workflowName: run.workflowName };
  }
}
