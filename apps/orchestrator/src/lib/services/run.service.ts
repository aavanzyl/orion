import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadProjectConfig, flattenProjectConfig } from '@orion/config';
import type { CreateRunEventInput, ProjectConfig, RunStatus, WorkflowRun } from '@orion/models';
import {
  WorkflowEngine,
  type NodeExecutor,
  type RunWorkspace,
} from '@orion/workflow-engine';
import type { Container } from '../container.js';
import { AgentNodeExecutor } from '../executors/agent.executor.js';
import { ShellNodeExecutor } from '../executors/shell.executor.js';
import { ApprovalNodeExecutor } from '../executors/approval.executor.js';
import { ScmNodeExecutor } from '../executors/scm.executor.js';
import { NotifyNodeExecutor } from '../executors/notify.executor.js';
import { CommentNodeExecutor } from '../executors/comment.executor.js';
import { ConditionNodeExecutor } from '../executors/condition.executor.js';
import { HttpNodeExecutor } from '../executors/http.executor.js';
import { WorkspaceService } from './workspace.service.js';

const execFileAsync = promisify(execFile);

interface ActiveRun {
  config: ProjectConfig;
  workspace: RunWorkspace;
  engine: WorkflowEngine;
  cleanupWorkspace: () => Promise<void>;
  controller: AbortController;
}

const RETRYABLE_STATUSES = new Set<RunStatus>(['failed', 'cancelled']);

/** Run statuses that mean the run is finished and no longer occupies a slot. */
const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['completed', 'failed', 'cancelled']);

/**
 * Pick the workflow a run should execute. A named workflow (from the project's
 * `workflows` map) takes precedence when requested; otherwise the top-level
 * `workflow` is used. The returned config always carries the resolved name.
 */
function selectWorkflow(config: ProjectConfig, workflowName?: string) {
  if (workflowName && workflowName !== config.workflow.name && config.workflows?.[workflowName]) {
    return { ...config.workflows[workflowName], name: workflowName };
  }
  return config.workflow;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'ticket';
}

function randomSuffix(length = 4): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + length);
}

function formatBranch(template: string | undefined, variables: Record<string, string>): string {
  const tpl = template || 'orion/$TICKET_SLUG-$RUN_ID_SHORT-$RANDOM';
  return tpl.replace(/\$(\w+)/g, (_, key) => variables[key] ?? `$${key}`);
}

/**
 * Coordinates a workflow run: prepares an isolated worktree, wires the engine
 * with adapter-backed executors, and drives execution while streaming events.
 *
 * A lightweight scheduler bounds how many runs execute at once
 * (`ORION_MAX_CONCURRENT_RUNS`); admitted runs beyond the limit are `queued`
 * and launched automatically as slots free up.
 */
export class RunService {
  private readonly active = new Map<string, ActiveRun>();
  private readonly workspaces: WorkspaceService;
  /** Run ids currently occupying a concurrency slot (running or waiting). */
  private readonly slots = new Set<string>();
  /** Run ids admitted but parked behind the concurrency limit (FIFO). */
  private readonly queue: string[] = [];

  constructor(private readonly c: Container) {
    this.workspaces = new WorkspaceService(c);
  }

  getRun(runId: string): Promise<WorkflowRun | null> {
    return this.c.runs.get(runId);
  }

  listNodes(runId: string) {
    return this.c.runs.listNodes(runId);
  }

  listEvents(runId: string) {
    return this.c.events.listByRun(runId);
  }

  listRunsForTicket(ticketId: string) {
    return this.c.runs.getByTicket(ticketId);
  }

  /** Create a run for a ticket and begin (or queue) executing its workflow.
   *
   * When `workflowName` is provided and resolves to a named entry in the
   * project's `workflows` map, that workflow is run instead of the top-level
   * `workflow`. This is how a swimlane can dictate its own sequence of events.
   */
  async start(ticketId: string, workflowName?: string): Promise<WorkflowRun> {
    const ticket = await this.c.tickets.get(ticketId);
    if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
    const project = await this.c.projects.get(ticket.projectId);
    if (!project) throw new Error(`Project ${ticket.projectId} not found`);

    const config = await this.workspaces
      .resolveConfigRoot(project)
      .then((root) => loadProjectConfig(root, project.configPath));

    const selected = selectWorkflow(config, workflowName);

    const run = await this.c.runs.create({
      ticketId,
      projectId: project.id,
      workflowName: selected.name,
      configSnapshot: {
        workflow: selected,
      } as unknown as Record<string, unknown>,
    });
    await this.emitStatus(run.id, 'run.created', { ticketId });

    return this.admit(run);
  }

  /**
   * React to a ticket entering a board column. If the project config maps that
   * swimlane to a workflow (`board.triggers`), start a run of that workflow —
   * unless the ticket already has one in flight. When a column maps to multiple
   * workflows (an array), the ticket's `workflowName` selects which one fires;
   * if the ticket has no binding, the first trigger is used. Best-effort: never
   * throws.
   */
  async handleSwimlaneEntry(ticketId: string, swimlane: string): Promise<void> {
    try {
      const ticket = await this.c.tickets.get(ticketId);
      if (!ticket) return;
      const project = await this.c.projects.get(ticket.projectId);
      if (!project) return;

      const config = await this.workspaces
        .resolveConfigRoot(project)
        .then((root) => loadProjectConfig(root, project.configPath));

      const raw = config.board.triggers?.[swimlane];
      if (!raw) return;

      const triggerNames = Array.isArray(raw) ? raw : [raw];
      const workflowName =
        triggerNames.length === 1
          ? triggerNames[0]
          : triggerNames.find((n) => n === ticket.workflowName) ?? triggerNames[0];

      const existing = await this.c.runs.getByTicket(ticketId);
      if (existing.some((r) => !TERMINAL_RUN_STATUSES.has(r.status))) return;

      await this.start(ticketId, workflowName);
    } catch (err) {
      console.error(`[ orion orchestrator ] failed to trigger workflow for swimlane "${swimlane}":`, err);
    }
  }

  /**
   * Re-run a failed (or cancelled) run, resuming from the last successful node.
   * Completed nodes are preserved; everything else is reset and re-executed in a
   * fresh worktree.
   */
  async retry(runId: string): Promise<WorkflowRun> {
    const run = await this.c.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (!RETRYABLE_STATUSES.has(run.status)) {
      throw new Error(`Run ${runId} is ${run.status}; only failed or cancelled runs can be retried`);
    }
    await this.cleanup(runId);
    await this.c.runs.resetForRetry(runId);
    const reset = await this.c.runs.update(runId, { status: 'created', error: null });
    await this.emitStatus(runId, 'log', { message: 'Run retried' });
    return this.admit(reset);
  }

  /** Approve a waiting node and continue the run. */
  async approve(runId: string, nodeKey: string): Promise<WorkflowRun> {
    const activeRun = this.active.get(runId);
    const run = await this.c.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (!activeRun) {
      throw new Error(`Run ${runId} is not active in this process and cannot be resumed`);
    }
    return this.drive(run, activeRun.config, activeRun.workspace, activeRun.controller, nodeKey);
  }

  /** Cancel a queued or in-flight run. */
  async cancel(runId: string): Promise<void> {
    const queuedAt = this.queue.indexOf(runId);
    if (queuedAt !== -1) this.queue.splice(queuedAt, 1);

    const activeRun = this.active.get(runId);
    if (activeRun) activeRun.controller.abort();
    await this.cleanup(runId);
    await this.c.runs.update(runId, { status: 'cancelled' });
    await this.emitStatus(runId, 'run.status', { status: 'cancelled' });
  }

  /**
   * Recover runs left mid-flight by a previous process. Their in-memory state
   * (worktree, engine) is gone, so they can never resume; mark them failed so
   * they surface on the board and can be retried. Call once on startup.
   */
  async recoverInterruptedRuns(): Promise<void> {
    const unfinished = await this.c.runs.listUnfinished();
    if (unfinished.length === 0) return;
    for (const run of unfinished) {
      await this.c.runs
        .update(run.id, { status: 'failed', error: 'Interrupted by an orchestrator restart' })
        .catch(() => undefined);
      await this.emitStatus(run.id, 'run.status', {
        status: 'failed',
        error: 'Interrupted by an orchestrator restart',
      });
    }
    console.log(`[ orion orchestrator ] recovered ${unfinished.length} interrupted run(s)`);
  }

  /** Launch immediately if a concurrency slot is free, otherwise queue. */
  private async admit(run: WorkflowRun): Promise<WorkflowRun> {
    if (this.canLaunch()) {
      return this.launch(run.id);
    }
    const queued = await this.c.runs.update(run.id, { status: 'queued' });
    this.queue.push(run.id);
    await this.emitStatus(run.id, 'run.status', { status: 'queued' });
    return queued;
  }

  private canLaunch(): boolean {
    const max = this.c.env.maxConcurrentRuns;
    return max <= 0 || this.slots.size < max;
  }

  /**
   * Prepare an isolated worktree, wire the engine and begin driving the run.
   * Reused by fresh starts, retries and queue draining. Occupies a slot.
   */
  private async launch(runId: string): Promise<WorkflowRun> {
    this.slots.add(runId);
    try {
      let run = await this.c.runs.get(runId);
      if (!run) throw new Error(`Run ${runId} not found`);
      const ticket = await this.c.tickets.get(run.ticketId);
      if (!ticket) throw new Error(`Ticket ${run.ticketId} not found`);
      const project = await this.c.projects.get(run.projectId);
      if (!project) throw new Error(`Project ${run.projectId} not found`);

      const scm = this.c.scm.get(project.scmProvider);
      const authoredConfig = await this.workspaces
        .resolveConfigRoot(project)
        .then((root) => loadProjectConfig(root, project.configPath));

      const selectedWorkflow = selectWorkflow(authoredConfig, run.workflowName);
      const config = flattenProjectConfig({ ...authoredConfig, workflow: selectedWorkflow });

      const ticketSlug = slugify(ticket.title);
      const runIdShort = run.id.slice(0, 8);
      const branch = formatBranch(authoredConfig.project.branchFormat, {
        TICKET_ID: ticket.id,
        TICKET_SLUG: ticketSlug,
        WORKFLOW_NAME: selectedWorkflow.name,
        RUN_ID: run.id,
        RUN_ID_SHORT: runIdShort,
        RANDOM: randomSuffix(),
      });
      const { workspace, cleanup: cleanupWorkspace } = await this.workspaces.prepare(
        project,
        run.id,
        branch,
      );
      run = await this.c.runs.update(run.id, { branch, worktreePath: workspace.rootPath });

      const controller = new AbortController();
      const executors: NodeExecutor[] = [
        new AgentNodeExecutor(
          this.c.harnesses,
          this.c.tickets,
          this.c.env,
          (projectId, query, topK) => this.c.ragService.search(projectId, query, topK),
        ),
        new ShellNodeExecutor(),
        new ApprovalNodeExecutor(),
        new ScmNodeExecutor(scm, this.c.tickets),
        new NotifyNodeExecutor(this.c.communication),
        new CommentNodeExecutor(this.c.linearSync),
        new ConditionNodeExecutor(),
        new HttpNodeExecutor({ encryptionSalt: this.c.env.providerEncryptionSalt }),
      ];

      const engine = new WorkflowEngine({
        store: this.c.runs,
        emit: async (input: CreateRunEventInput) => {
          const event = await this.c.events.append(input);
          this.c.bus.publish(event);
        },
        moveTicket: async (id, swimlane) => {
          await this.c.boards.get(project.boardProvider).moveTicket({ ticketId: id, swimlane });
          this.c.linearSync.pushTicketState(id).catch(() => undefined);
          this.c.bus.emit(`board:${run.projectId}`, { type: 'ticket.updated', ticketId: id, swimlane });
        },
        executors,
      });

      this.active.set(run.id, { config, workspace, engine, cleanupWorkspace, controller });

      // Fresh run: materialize nodes. Retry: nodes already exist (and were reset).
      const existing = await this.c.runs.listNodes(run.id);
      if (existing.length === 0) {
        await engine.initializeNodes(run.id, config);
      }

      void this.drive(run, config, workspace, controller);
      return run;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.c.runs.update(runId, { status: 'failed', error }).catch(() => undefined);
      await this.emitStatus(runId, 'run.status', { status: 'failed', error });
      await this.cleanup(runId);
      throw err;
    }
  }

  private async drive(
    run: WorkflowRun,
    config: ProjectConfig,
    workspace: RunWorkspace,
    controller: AbortController,
    approveNodeKey?: string,
  ): Promise<WorkflowRun> {
    const activeRun = this.active.get(run.id);
    if (!activeRun) {
      throw new Error(`Run ${run.id} is not active`);
    }
    try {
      const result = approveNodeKey
        ? await activeRun.engine.approve(run, config, workspace, approveNodeKey)
        : await activeRun.engine.advance(run, config, workspace, controller.signal);

      await this.captureDiff(run.id, workspace);

      if (result.status === 'completed') {
        await this.aggregateArtifacts(run.id);
        await this.notifyRun(result, 'info', 'Run completed');
      } else if (result.status === 'failed') {
        await this.aggregateArtifacts(run.id);
        await this.notifyRun(result, 'error', 'Run failed', result.error);
      } else if (result.status === 'waiting') {
        await this.notifyRun(result, 'warn', 'Run awaiting approval');
      }

      // A waiting run keeps its worktree and slot until it is approved.
      if (result.status === 'completed' || result.status === 'failed') {
        await this.cleanup(run.id);
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const failed = await this.c.runs.update(run.id, { status: 'failed', error });
      await this.aggregateArtifacts(run.id);
      await this.notifyRun(failed, 'error', 'Run failed', error);
      await this.cleanup(run.id);
      throw err;
    }
  }

  private async captureDiff(runId: string, workspace: RunWorkspace): Promise<void> {
    try {
      const { stdout } = await execFileAsync('sh', ['-c', 'git diff --stat HEAD~1'], {
        cwd: workspace.rootPath,
        maxBuffer: 1024 * 1024 * 32,
      });
      const diff = stdout.trim();
      if (diff) {
        await this.c.runs.update(runId, { diff });
        await this.emitStatus(runId, 'run.diff', { diff });
      }
    } catch {
      // Diff capture is best-effort; never fail the run over it.
    }
  }

  private async aggregateArtifacts(runId: string): Promise<void> {
    try {
      const nodes = await this.c.runs.listNodes(runId);
      const nodeOutputs: Record<string, unknown> = {};
      const logs: string[] = [];
      for (const node of nodes) {
        if (node.output !== undefined && node.output !== null) {
          nodeOutputs[node.nodeKey] = node.output;
        }
        if (node.error) {
          logs.push(`[${node.nodeKey}] ${node.error}`);
        }
      }
      const artifacts = { nodeOutputs, aggregatedLogs: logs.length > 0 ? logs.join('\n') : undefined };
      await this.c.runs.update(runId, { artifacts });
    } catch {
      // Artifact aggregation is best-effort.
    }
  }

  /** Fan a run lifecycle notification out to every registered notifier. */
  private async notifyRun(
    run: WorkflowRun,
    level: 'info' | 'warn' | 'error',
    headline: string,
    extra?: string,
  ): Promise<void> {
    const keys = this.c.communication.keys();
    if (keys.length === 0) return;

    const ticket = await this.c.tickets.get(run.ticketId).catch(() => null);
    const notification = {
      title: `Orion: ${headline}`,
      body: [
        `Ticket: ${ticket?.title ?? run.ticketId}`,
        `Workflow: ${run.workflowName}`,
        extra ? `Details: ${extra}` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
      level,
    };

    await Promise.all(
      keys.map((key) => this.c.communication.get(key).notify(notification).catch(() => undefined)),
    );
  }

  private async emitStatus(
    runId: string,
    type: 'run.created' | 'run.status' | 'run.diff' | 'log',
    payload: unknown,
  ): Promise<void> {
    const event = await this.c.events.append({ runId, type, payload });
    this.c.bus.publish(event);
  }

  /** Tear down a run's workspace and release its concurrency slot. */
  private async cleanup(runId: string): Promise<void> {
    const activeRun = this.active.get(runId);
    if (activeRun) {
      await activeRun.cleanupWorkspace().catch(() => undefined);
      this.active.delete(runId);
    }
    this.releaseSlot(runId);
  }

  /** Free a slot and launch the next queued run, if any. */
  private releaseSlot(runId: string): void {
    if (!this.slots.delete(runId)) return;
    const next = this.queue.shift();
    if (next) {
      void this.launch(next).catch((err: unknown) => {
        console.error(`[ orion orchestrator ] failed to launch queued run ${next}:`, err);
      });
    }
  }
}
