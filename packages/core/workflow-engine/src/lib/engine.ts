import type {
  ProjectConfig,
  RunNode,
  WorkflowNodeConfig,
  WorkflowRun,
} from '@orion/models';
import { evaluateCondition, resolveNodeReference } from '@orion/config';
import type { EmitEvent, MoveTicket, RunStore } from './ports.js';
import type {
  NodeExecutionContext,
  NodeExecutor,
  NodeOutcome,
  NodeTelemetry,
  NodeUsage,
  RunWorkspace,
} from './executor.js';

export interface EngineDeps {
  store: RunStore;
  emit: EmitEvent;
  moveTicket: MoveTicket;
  executors: NodeExecutor[];
}

const TERMINAL_NODE = new Set(['completed', 'skipped', 'cancelled']);

/** Sum two optional usage records field-by-field, returning undefined if both
 * are empty so nodes without usage stay clean. */
function addUsage(a: NodeUsage | undefined, b: NodeUsage | undefined): NodeUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  const sum = (x?: number, y?: number): number | undefined =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  return {
    inputTokens: sum(a.inputTokens, b.inputTokens),
    outputTokens: sum(a.outputTokens, b.outputTokens),
    totalTokens: sum(a.totalTokens, b.totalTokens),
    cachedInputTokens: sum(a.cachedInputTokens, b.cachedInputTokens),
    costUsd: sum(a.costUsd, b.costUsd),
  };
}

/** A node status that satisfies a downstream dependency. `skipped` counts so
 * that advisory (`continueOnError`) nodes never block the rest of the graph. */
const SATISFIES_DEPENDENCY = new Set(['completed', 'skipped']);

/** Durable marker stored on a node's `output` when it is condition-skipped,
 * distinguishing it from an advisory (`continueOnError`) skip which carries no
 * marker and therefore never cascades. */
function conditionSkipMarker(): { __orionSkipped: 'condition' } {
  return { __orionSkipped: 'condition' };
}

/** True when a node was skipped because a `condition` node upstream (or its
 * whole incoming branch) was false, as opposed to an advisory `continueOnError`
 * skip. */
export function isConditionSkipped(node: Pick<RunNode, 'status' | 'output'>): boolean {
  return (
    node.status === 'skipped' &&
    typeof node.output === 'object' &&
    node.output !== null &&
    (node.output as { __orionSkipped?: unknown }).__orionSkipped === 'condition'
  );
}

/** Outcome of processing a single ready node during one scheduling pass. */
interface NodeStepResult {
  result: 'completed' | 'waiting' | 'failed' | 'skipped';
  threadId?: string;
}

/**
 * Deterministic DAG scheduler. It owns the process — ordering, dependencies and
 * approvals — while delegating all reasoning/work to injected NodeExecutors.
 * The engine never talks to an AI model directly.
 */
export class WorkflowEngine {
  private readonly executors: Map<string, NodeExecutor>;

  constructor(private readonly deps: EngineDeps) {
    this.executors = new Map(deps.executors.map((e) => [e.type, e]));
  }

  /** Materialize run nodes from the workflow config (idempotent per run). */
  async initializeNodes(runId: string, config: ProjectConfig): Promise<void> {
    for (const node of config.workflow.nodes) {
      await this.deps.store.createNode({
        runId,
        nodeKey: node.id,
        type: node.type,
        dependsOn: node.dependsOn ?? [],
      });
    }
  }

  /**
   * Drive the run forward until it completes, fails, or blocks on an approval
   * (or other `waiting` node). Safe to call repeatedly (e.g. after an approval).
   *
   * Independent nodes that become ready in the same pass are executed in
   * parallel (DAG fan-out); the run only advances once they all settle.
   */
  async advance(
    run: WorkflowRun,
    config: ProjectConfig,
    workspace: RunWorkspace,
    signal?: AbortSignal,
  ): Promise<WorkflowRun> {
    let current = await this.setRunStatus(run, 'running');

    for (;;) {
      const nodes = await this.deps.store.listNodes(current.id);
      const byKey = new Map(nodes.map((n) => [n.nodeKey, n]));

      if (nodes.some((n) => n.status === 'failed')) {
        return this.setRunStatus(current, 'failed');
      }
      if (nodes.every((n) => TERMINAL_NODE.has(n.status))) {
        return this.setRunStatus(current, 'completed');
      }

      const budget = config.workflow.budget;
      if (budget) {
        const latest = await this.deps.store.get(current.id);
        if (latest) {
          if (budget.maxTokens && (latest.totalTokens ?? 0) >= budget.maxTokens) {
            return this.setRunStatus(current, 'failed', `Budget exceeded: maxTokens limit (${budget.maxTokens}) reached`);
          }
          if (budget.maxCostUsd && (latest.costUsd ?? 0) >= budget.maxCostUsd) {
            return this.setRunStatus(current, 'failed', `Budget exceeded: maxCostUsd limit (${budget.maxCostUsd}) reached`);
          }
        }
      }

      const nodeOutputs: Record<string, unknown> = {};
      for (const n of nodes) {
        if (
          (n.status === 'completed' || n.status === 'skipped') &&
          n.output !== undefined &&
          n.output !== null &&
          !isConditionSkipped(n)
        ) {
          nodeOutputs[n.nodeKey] = n.output;
        }
      }

      const ready = nodes.filter(
        (n) =>
          (n.status === 'pending' || n.status === 'ready') &&
          n.dependsOn.every((dep) => SATISFIES_DEPENDENCY.has(byKey.get(dep)?.status ?? '')),
      );

      if (ready.length === 0) {
        // Nothing runnable: either an approval/other node is waiting, or the
        // remaining nodes are blocked by an unmet dependency. Either way the run
        // pauses until an external event (approval) resumes it.
        return this.setRunStatus(current, 'waiting');
      }

      const results = await Promise.all(
        ready.map((node) =>
          this.processNode(current, node, config, workspace, signal, nodeOutputs, byKey),
        ),
      );

      // A hard failure (one that isn't opted into continueOnError) fails the run.
      if (results.some((r) => r.result === 'failed')) {
        return this.setRunStatus(current, 'failed');
      }

      const threaded = results.find((r) => r.threadId);
      if (threaded?.threadId) {
        current = await this.deps.store.update(current.id, { threadId: threaded.threadId });
      }

      if (results.some((r) => r.result === 'waiting')) {
        return this.setRunStatus(current, 'waiting');
      }
    }
  }

  /** Run a single ready node and persist its outcome, returning a summary. */
  private async processNode(
    run: WorkflowRun,
    node: RunNode,
    config: ProjectConfig,
    workspace: RunWorkspace,
    signal: AbortSignal | undefined,
    nodeOutputs: Record<string, unknown>,
    byKey: Map<string, RunNode>,
  ): Promise<NodeStepResult> {
    const nodeConfig = config.workflow.nodes.find((c) => c.id === node.nodeKey);
    if (!nodeConfig) {
      const error = `No config found for node "${node.nodeKey}"`;
      await this.failNode(node, error);
      await this.deps.emit({
        runId: run.id,
        nodeId: node.id,
        type: 'node.failed',
        payload: { nodeKey: node.nodeKey, error },
      });
      return { result: 'failed' };
    }

    // Multi-branch condition routing: evaluate branches before running the
    // executor, so non-selected downstream targets are skipped immediately.
    if (
      nodeConfig.type === 'condition' &&
      nodeConfig.branches &&
      nodeConfig.branches.length > 0
    ) {
      return this.routeConditionBranches(
        run,
        node,
        nodeConfig,
        nodeOutputs,
        byKey,
      );
    }

    if (this.shouldConditionSkip(node, nodeConfig, nodeOutputs, byKey)) {
      await this.deps.store.updateNode(node.id, {
        status: 'skipped',
        output: conditionSkipMarker(),
        completedAt: new Date().toISOString(),
      });
      await this.deps.emit({
        runId: run.id,
        nodeId: node.id,
        type: 'node.skipped',
        payload: { nodeKey: node.nodeKey, reason: 'condition' },
      });
      return { result: 'skipped' };
    }

    const startedMs = Date.now();
    const outcome = await this.runNode(run, node, nodeConfig, config, workspace, signal, nodeOutputs);
    const durationMs = Date.now() - startedMs;
    const telemetry = { ...outcome.telemetry, durationMs } satisfies NodeTelemetry & {
      durationMs: number;
    };

    if (outcome.status === 'failed') {
      if (nodeConfig.continueOnError) {
        // Advisory node: record the failure but let the workflow continue.
        await this.deps.store.updateNode(node.id, {
          status: 'skipped',
          error: outcome.error,
          completedAt: new Date().toISOString(),
          ...telemetry,
        });
        await this.deps.emit({
          runId: run.id,
          nodeId: node.id,
          type: 'node.failed',
          payload: { nodeKey: node.nodeKey, error: outcome.error, continued: true },
        });
        return { result: 'skipped' };
      }
      await this.failNode(node, outcome.error, telemetry);
      await this.deps.emit({
        runId: run.id,
        nodeId: node.id,
        type: 'node.failed',
        payload: { nodeKey: node.nodeKey, error: outcome.error },
      });
      return { result: 'failed' };
    }

    if (outcome.status === 'waiting') {
      await this.deps.store.updateNode(node.id, { status: 'waiting', output: outcome.output });
      await this.deps.emit({
        runId: run.id,
        nodeId: node.id,
        type: 'node.status',
        payload: { nodeKey: node.nodeKey, status: 'waiting' },
      });
      return { result: 'waiting' };
    }

    await this.deps.store.updateNode(node.id, {
      status: 'completed',
      output: outcome.output,
      usage: outcome.usage,
      completedAt: new Date().toISOString(),
      ...telemetry,
    });
    if (this.deps.store.recomputeUsage) {
      await this.deps.store.recomputeUsage(run.id);
    }
    await this.deps.emit({
      runId: run.id,
      nodeId: node.id,
      type: 'node.completed',
      payload: { nodeKey: node.nodeKey, output: outcome.output, usage: outcome.usage },
    });
    return { result: 'completed', threadId: outcome.threadId };
  }

  /**
   * Decide whether a ready node should be condition-skipped before running its
   * executor: either it is a `condition` node whose expression is false, or it
   * has dependencies and every one of them was itself condition-skipped (its
   * incoming branch was not taken). Advisory (`continueOnError`) skips carry no
   * marker so they never trigger the branch cascade.
   */
  private shouldConditionSkip(
    node: RunNode,
    nodeConfig: WorkflowNodeConfig,
    nodeOutputs: Record<string, unknown>,
    byKey: Map<string, RunNode>,
  ): boolean {
    // A dedicated `condition` node gates its downstream branch: when its
    // expression is false the node is condition-skipped, cascading to any nodes
    // that depend exclusively on it (via the branch rule below).
    // Legacy single-expression condition gate. When `branches` is also present
    // the multi-branch routing handled above takes precedence.
    if (
      nodeConfig.type === 'condition' &&
      !nodeConfig.branches?.length &&
      nodeConfig.condition != null &&
      evaluateCondition(nodeConfig.condition, nodeOutputs) === false
    ) {
      return true;
    }
    if (
      node.dependsOn.length > 0 &&
      node.dependsOn.every((dep) => {
        const d = byKey.get(dep);
        return d !== undefined && isConditionSkipped(d);
      })
    ) {
      return true;
    }
    return false;
  }

  /**
   * Evaluate multi-branch condition routing (if / else-if / else). The first
   * branch whose expression is truthy is selected; a trailing branch without
   * an expression is the else. Non-selected branches' targets are explicitly
   * condition-skipped so the cascade picks them up in the next pass. When no
   * branch matches (including no else), every downstream dependent is allowed
   * to proceed.
   */
  private async routeConditionBranches(
    run: WorkflowRun,
    node: RunNode,
    nodeConfig: WorkflowNodeConfig,
    nodeOutputs: Record<string, unknown>,
    byKey: Map<string, RunNode>,
  ): Promise<NodeStepResult> {
    const branches = nodeConfig.branches!;
    let selectedIndex = -1;

    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      if (b.expression) {
        if (evaluateCondition(b.expression, nodeOutputs)) {
          selectedIndex = i;
          break;
        }
      } else {
        selectedIndex = i;
        break;
      }
    }

    await this.deps.store.updateNode(node.id, {
      status: 'completed',
      output: { branchIndex: selectedIndex, branches },
      completedAt: new Date().toISOString(),
    });
    await this.deps.emit({
      runId: run.id,
      nodeId: node.id,
      type: 'node.completed',
      payload: { nodeKey: node.nodeKey, branchIndex: selectedIndex },
    });

    for (let i = 0; i < branches.length; i++) {
      if (i === selectedIndex) continue;
      const targetKey = branches[i].target;
      if (!targetKey) continue;
      const targetNode = byKey.get(targetKey);
      if (targetNode) {
        await this.deps.store.updateNode(targetNode.id, {
          status: 'skipped',
          output: conditionSkipMarker(),
          completedAt: new Date().toISOString(),
        });
        await this.deps.emit({
          runId: run.id,
          nodeId: targetNode.id,
          type: 'node.skipped',
          payload: { nodeKey: targetNode.nodeKey, reason: 'condition' },
        });
      }
    }

    return { result: 'completed' };
  }

  /** Resolve a waiting approval node and continue the run. */
  async approve(
    run: WorkflowRun,
    config: ProjectConfig,
    workspace: RunWorkspace,
    nodeKey: string,
  ): Promise<WorkflowRun> {
    const nodes = await this.deps.store.listNodes(run.id);
    const node = nodes.find((n) => n.nodeKey === nodeKey);
    if (node && node.status === 'waiting') {
      await this.deps.store.updateNode(node.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      await this.deps.emit({
        runId: run.id,
        nodeId: node.id,
        type: 'node.completed',
        payload: { nodeKey, approved: true },
      });
    }
    return this.advance(run, config, workspace);
  }

  private async runNode(
    run: WorkflowRun,
    node: RunNode,
    nodeConfig: WorkflowNodeConfig,
    config: ProjectConfig,
    workspace: RunWorkspace,
    signal: AbortSignal | undefined,
    nodeOutputs: Record<string, unknown>,
  ): Promise<NodeOutcome> {
    const executor = this.executors.get(node.type);
    if (!executor) {
      return { status: 'failed', error: `No executor for node type "${node.type}"` };
    }

    await this.deps.store.updateNode(node.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    await this.deps.emit({
      runId: run.id,
      nodeId: node.id,
      type: 'node.started',
      payload: { nodeKey: node.nodeKey, type: node.type },
    });

    if (nodeConfig.swimlane) {
      await this.deps.moveTicket(run.ticketId, nodeConfig.swimlane);
      await this.deps.emit({
        runId: run.id,
        nodeId: node.id,
        type: 'ticket.moved',
        payload: { ticketId: run.ticketId, swimlane: nodeConfig.swimlane },
      });
    }

    if (nodeConfig.matrix) {
      return this.runMatrix(run, node, nodeConfig, config, workspace, executor, signal, nodeOutputs);
    }

    if (nodeConfig.loop) {
      return this.runLoop(run, node, nodeConfig, config, workspace, executor, signal, nodeOutputs);
    }

    return this.runAttempts(run, node, nodeConfig, config, workspace, executor, run, signal, nodeOutputs);
  }

  /**
   * Iteratively re-run the node's executor until the `until` sentinel appears in
   * the stringified iteration output, an iteration fails, or `maxIterations` is
   * reached (which fails the node). When not `freshContext`, the previous
   * iteration's threadId is threaded into the next so context accumulates.
   */
  private async runLoop(
    run: WorkflowRun,
    node: RunNode,
    nodeConfig: WorkflowNodeConfig,
    config: ProjectConfig,
    workspace: RunWorkspace,
    executor: NodeExecutor,
    signal: AbortSignal | undefined,
    nodeOutputs: Record<string, unknown>,
  ): Promise<NodeOutcome> {
    const loop = nodeConfig.loop!;
    let iterationRun: WorkflowRun = run;
    let outcome: NodeOutcome = { status: 'failed', error: 'loop did not run' };
    let totalUsage: NodeUsage | undefined;

    for (let iteration = 1; iteration <= loop.maxIterations; iteration++) {
      await this.deps.emit({
        runId: run.id,
        nodeId: node.id,
        type: 'node.iteration',
        payload: { nodeKey: node.nodeKey, iteration, maxIterations: loop.maxIterations },
      });

      outcome = await this.runAttempts(
        run,
        node,
        nodeConfig,
        config,
        workspace,
        executor,
        iterationRun,
        signal,
        nodeOutputs,
      );

      if (outcome.status !== 'completed') {
        return outcome;
      }

      totalUsage = addUsage(totalUsage, outcome.usage);

      if (JSON.stringify(outcome.output ?? '').includes(loop.until)) {
        return { ...outcome, usage: totalUsage };
      }

      if (!loop.freshContext && outcome.threadId) {
        iterationRun = { ...iterationRun, threadId: outcome.threadId };
      }
    }

    return {
      status: 'failed',
      error: `loop reached maxIterations (${loop.maxIterations}) without "${loop.until}"`,
    };
  }

  /**
   * Fan the node out into one concurrent execution per matrix item. Items come
   * from a literal array or a `nodes.<id>[.path]` reference resolved against the
   * upstream outputs. Each item runs through the same attempt/retry/timeout
   * machinery; the node completes with `{ items: [...] }` (usage summed) or fails
   * naming the first failed index.
   */
  private async runMatrix(
    run: WorkflowRun,
    node: RunNode,
    nodeConfig: WorkflowNodeConfig,
    config: ProjectConfig,
    workspace: RunWorkspace,
    executor: NodeExecutor,
    signal: AbortSignal | undefined,
    nodeOutputs: Record<string, unknown>,
  ): Promise<NodeOutcome> {
    const matrix = nodeConfig.matrix!;

    let items: unknown[];
    if (Array.isArray(matrix.items)) {
      items = matrix.items;
    } else {
      const ref = matrix.items.trim();
      const parsed = /^nodes\.([A-Za-z0-9_-]+)((?:\.[A-Za-z0-9_]+)*)$/.exec(ref);
      if (!parsed) {
        return { status: 'failed', error: `matrix.items reference "${matrix.items}" is not a valid node output reference` };
      }
      const segments = parsed[2] ? parsed[2].replace(/^\./, '').split('.') : [];
      const resolved = resolveNodeReference(nodeOutputs, parsed[1], segments);
      if (!Array.isArray(resolved)) {
        return { status: 'failed', error: `matrix.items reference "${matrix.items}" did not resolve to an array` };
      }
      items = resolved;
    }

    await this.deps.emit({
      runId: run.id,
      nodeId: node.id,
      type: 'node.matrix',
      payload: { nodeKey: node.nodeKey, total: items.length },
    });

    if (items.length === 0) {
      return { status: 'completed', output: { items: [] } };
    }

    const total = items.length;
    const as = matrix.as;
    const maxParallel =
      matrix.maxParallel && matrix.maxParallel > 0
        ? Math.min(matrix.maxParallel, total)
        : total;

    // Run items in bounded waves, preserving per-item output order. A worker
    // pool pulls the next index until the queue drains.
    const outcomes: NodeOutcome[] = new Array(total);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (signal?.aborted) return;
        const index = cursor++;
        if (index >= total) return;
        outcomes[index] = await this.runAttempts(
          run,
          node,
          nodeConfig,
          config,
          workspace,
          executor,
          run,
          signal,
          nodeOutputs,
          { item: items[index], index, total, as },
        );
      }
    };
    await Promise.all(Array.from({ length: maxParallel }, () => worker()));

    let totalUsage: NodeUsage | undefined;
    const outputs: unknown[] = [];
    for (let index = 0; index < outcomes.length; index++) {
      const outcome = outcomes[index];
      if (outcome.status !== 'completed') {
        const reason = outcome.status === 'failed' ? outcome.error : 'item did not complete';
        return { status: 'failed', error: `matrix item ${index} failed: ${reason}` };
      }
      outputs.push(outcome.output);
      totalUsage = addUsage(totalUsage, outcome.usage);
    }

    return { status: 'completed', output: { items: outputs }, usage: totalUsage };
  }

  /**
   * Run the node's executor once, honoring its retry/timeout policy. The
   * `contextRun` supplies the threadId the execution context should observe
   * (updated between loop iterations). An optional `matrix` context marks the
   * execution as one item of a matrix fan-out.
   */
  private async runAttempts(
    run: WorkflowRun,
    node: RunNode,
    nodeConfig: WorkflowNodeConfig,
    config: ProjectConfig,
    workspace: RunWorkspace,
    executor: NodeExecutor,
    contextRun: WorkflowRun,
    signal: AbortSignal | undefined,
    nodeOutputs: Record<string, unknown>,
    matrix?: { item: unknown; index: number; total: number; as?: string },
  ): Promise<NodeOutcome> {
    const makeCtx = (attemptSignal?: AbortSignal): NodeExecutionContext => ({
      run: contextRun,
      node,
      nodeConfig,
      config,
      workspace,
      ticketId: run.ticketId,
      signal: attemptSignal,
      emit: (type, payload) => this.deps.emit({ runId: run.id, nodeId: node.id, type, payload }),
      nodeOutputs,
      matrix,
    });

    const maxAttempts = Math.max(1, (nodeConfig.retries ?? 0) + 1);
    const retryDelayMs = nodeConfig.retryDelayMs ?? 0;
    let outcome: NodeOutcome = { status: 'failed', error: 'node did not run' };
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attemptsMade = attempt;
      outcome = await this.attempt(executor, makeCtx, nodeConfig.timeoutMs, signal);

      if (outcome.status !== 'failed' || signal?.aborted || attempt >= maxAttempts) {
        break;
      }

      await this.deps.emit({
        runId: run.id,
        nodeId: node.id,
        type: 'node.retry',
        payload: {
          nodeKey: node.nodeKey,
          attempt,
          maxAttempts,
          error: outcome.error,
        },
      });

      if (retryDelayMs > 0) await this.delay(retryDelayMs, signal);
    }

    return { ...outcome, telemetry: { ...outcome.telemetry, attempts: attemptsMade } };
  }

  /**
   * Run a single execution attempt, enforcing an optional timeout. The attempt
   * receives a derived AbortSignal that fires on run cancellation or timeout so
   * well-behaved executors can stop promptly.
   */
  private async attempt(
    executor: NodeExecutor,
    makeCtx: (signal?: AbortSignal) => NodeExecutionContext,
    timeoutMs: number | undefined,
    outerSignal?: AbortSignal,
  ): Promise<NodeOutcome> {
    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    if (outerSignal) {
      if (outerSignal.aborted) controller.abort();
      else outerSignal.addEventListener('abort', relayAbort, { once: true });
    }

    let timedOut = false;
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : undefined;

    try {
      const outcome = await executor.execute(makeCtx(controller.signal));
      if (timedOut) {
        return { status: 'failed', error: `node timed out after ${timeoutMs}ms`, telemetry: { ...outcome.telemetry, timedOut: true } };
      }
      return outcome;
    } catch (err) {
      if (timedOut) {
        return { status: 'failed', error: `node timed out after ${timeoutMs}ms`, telemetry: { timedOut: true } };
      }
      return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    } finally {
      if (timer) clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', relayAbort);
    }
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async failNode(node: RunNode, error: string, telemetry?: NodeTelemetry): Promise<void> {
    await this.deps.store.updateNode(node.id, {
      status: 'failed',
      error,
      completedAt: new Date().toISOString(),
      ...telemetry,
    });
  }

  private async setRunStatus(
    run: WorkflowRun,
    status: WorkflowRun['status'],
    error?: string,
  ): Promise<WorkflowRun> {
    if (run.status === status && !error) return run;
    const updated = await this.deps.store.update(run.id, { status, error: error ?? null });
    await this.deps.emit({ runId: run.id, type: 'run.status', payload: { status, error } });
    return updated;
  }
}
