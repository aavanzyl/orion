import { and, asc, desc, eq, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import type {
  RunId,
  RunNode,
  RunNodeStatus,
  RunStatus,
  WorkflowNodeType,
  WorkflowRun,
} from '@orion/models';
import type { Database } from '../client.js';
import { runNodes, tickets, workflowRuns, projects } from '../schema.js';
import { toRunNode, toWorkflowRun } from '../mappers.js';

export interface CreateRunInput {
  ticketId: string;
  projectId: string;
  workflowName: string;
  configSnapshot?: Record<string, unknown>;
}

export interface CreateRunNodeInput {
  runId: RunId;
  nodeKey: string;
  type: WorkflowNodeType;
  dependsOn: string[];
  status?: RunNodeStatus;
}

export interface RunListFilter {
  projectId?: string;
  status?: RunStatus | RunStatus[];
  from?: string;
  to?: string;
  limit?: number;
  search?: string;
}

export interface RunAnalyticsFilter {
  projectId?: string;
  days?: number;
}

export interface RunAnalytics {
  successRate: number;
  totalRuns: number;
  totalCostUsd: number;
  totalTokens: number;
  runsByDay: Array<{ date: string; count: number; costUsd: number }>;
  byProject: Array<{ projectId: string; name: string; runs: number; successRate: number; costUsd: number }>;
  byWorkflow: Array<{ workflow: string; runs: number; successRate: number; costUsd: number }>;
}

/**
 * Run patch. Nullable fields may be cleared by passing `null` (e.g. resetting a
 * run's `error` on retry); `undefined` leaves the existing value untouched.
 */
export type RunUpdate = Partial<Omit<WorkflowRun, 'id' | 'error' | 'branch' | 'worktreePath' | 'diff' | 'artifacts'>> & {
  error?: string | null;
  branch?: string | null;
  worktreePath?: string | null;
  diff?: string | null;
  artifacts?: WorkflowRun['artifacts'] | null;
  totalTokens?: number;
  costUsd?: number;
};

export class RunRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateRunInput): Promise<WorkflowRun> {
    const [row] = await this.db
      .insert(workflowRuns)
      .values({
        ticketId: input.ticketId,
        projectId: input.projectId,
        workflowName: input.workflowName,
        status: 'created',
        configSnapshot: input.configSnapshot,
        totalTokens: 0,
        costUsd: 0,
      })
      .returning();
    return toWorkflowRun(row);
  }

  async get(id: RunId): Promise<WorkflowRun | null> {
    const [row] = await this.db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
    return row ? toWorkflowRun(row) : null;
  }

  async getByTicket(ticketId: string): Promise<WorkflowRun[]> {
    const rows = await this.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.ticketId, ticketId))
      .orderBy(asc(workflowRuns.createdAt));
    return rows.map(toWorkflowRun);
  }

  async list(filter?: RunListFilter): Promise<Array<WorkflowRun & { ticketTitle?: string }>> {
    const conditions: SQL<unknown>[] = [];
    if (filter?.projectId) conditions.push(eq(workflowRuns.projectId, filter.projectId));
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      conditions.push(inArray(workflowRuns.status, statuses));
    }
    if (filter?.from) conditions.push(gte(workflowRuns.createdAt, new Date(filter.from)));
    if (filter?.to) conditions.push(lte(workflowRuns.createdAt, new Date(filter.to)));
    if (filter?.search) {
      conditions.push(sql`${tickets.title} ilike ${`%${filter.search}%`}`);
    }

    const rows = await this.db
      .select({
        id: workflowRuns.id,
        ticketId: workflowRuns.ticketId,
        projectId: workflowRuns.projectId,
        workflowName: workflowRuns.workflowName,
        status: workflowRuns.status,
        branch: workflowRuns.branch,
        worktreePath: workflowRuns.worktreePath,
        threadId: workflowRuns.threadId,
        error: workflowRuns.error,
        diff: workflowRuns.diff,
        artifacts: workflowRuns.artifacts,
        configSnapshot: workflowRuns.configSnapshot,
        totalTokens: workflowRuns.totalTokens,
        costUsd: workflowRuns.costUsd,
        createdAt: workflowRuns.createdAt,
        updatedAt: workflowRuns.updatedAt,
        ticketTitle: tickets.title,
      })
      .from(workflowRuns)
      .leftJoin(tickets, eq(workflowRuns.ticketId, tickets.id))
      .where(and(...conditions))
      .orderBy(desc(workflowRuns.createdAt))
      .limit(filter?.limit ?? 50);

    return rows.map((row) => ({
      ...toWorkflowRun(row as typeof workflowRuns.$inferSelect),
      ticketTitle: row.ticketTitle ?? undefined,
    }));
  }

  async analytics(filter?: RunAnalyticsFilter): Promise<RunAnalytics> {
    const since = filter?.days
      ? new Date(Date.now() - filter.days * 24 * 60 * 60 * 1000)
      : undefined;

    const whereConditions: SQL<unknown>[] = [];
    if (filter?.projectId) whereConditions.push(eq(workflowRuns.projectId, filter.projectId));
    if (since) whereConditions.push(gte(workflowRuns.createdAt, since));

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const [summary] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${workflowRuns.status} = 'completed')::int`,
        totalCostUsd: sql<number>`coalesce(sum(${workflowRuns.costUsd}), 0)`,
        totalTokens: sql<number>`coalesce(sum(${workflowRuns.totalTokens}), 0)`,
      })
      .from(workflowRuns)
      .where(whereClause);

    const total = Number(summary?.total ?? 0);
    const completed = Number(summary?.completed ?? 0);
    const successRate = total > 0 ? Math.round((completed / total) * 10000) / 100 : 0;

    const dailyRows = await this.db
      .select({
        date: sql<string>`to_char(${workflowRuns.createdAt}::date, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
        costUsd: sql<number>`coalesce(sum(${workflowRuns.costUsd}), 0)`,
      })
      .from(workflowRuns)
      .where(whereClause)
      .groupBy(sql`${workflowRuns.createdAt}::date`)
      .orderBy(sql`${workflowRuns.createdAt}::date`)
      .limit(90);

    const projectRows = await this.db
      .select({
        projectId: workflowRuns.projectId,
        name: projects.name,
        runs: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${workflowRuns.status} = 'completed')::int`,
        costUsd: sql<number>`coalesce(sum(${workflowRuns.costUsd}), 0)`,
      })
      .from(workflowRuns)
      .leftJoin(projects, eq(workflowRuns.projectId, projects.id))
      .where(whereClause)
      .groupBy(workflowRuns.projectId, projects.name);

    const workflowRows = await this.db
      .select({
        workflow: workflowRuns.workflowName,
        runs: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${workflowRuns.status} = 'completed')::int`,
        costUsd: sql<number>`coalesce(sum(${workflowRuns.costUsd}), 0)`,
      })
      .from(workflowRuns)
      .where(whereClause)
      .groupBy(workflowRuns.workflowName);

    return {
      successRate,
      totalRuns: total,
      totalCostUsd: Number(summary?.totalCostUsd ?? 0),
      totalTokens: Number(summary?.totalTokens ?? 0),
      runsByDay: dailyRows.map((r) => ({
        date: r.date,
        count: Number(r.count),
        costUsd: Number(r.costUsd),
      })),
      byProject: projectRows.map((r) => ({
        projectId: r.projectId,
        name: r.name ?? '',
        runs: Number(r.runs),
        successRate: Number(r.runs) > 0 ? Math.round((Number(r.completed) / Number(r.runs)) * 10000) / 100 : 0,
        costUsd: Number(r.costUsd),
      })),
      byWorkflow: workflowRows.map((r) => ({
        workflow: r.workflow,
        runs: Number(r.runs),
        successRate: Number(r.runs) > 0 ? Math.round((Number(r.completed) / Number(r.runs)) * 10000) / 100 : 0,
        costUsd: Number(r.costUsd),
      })),
    };
  }

  /** Runs that are not in a terminal state — used for crash recovery on boot. */
  async listUnfinished(): Promise<WorkflowRun[]> {
    const rows = await this.db
      .select()
      .from(workflowRuns)
      .where(
        inArray(workflowRuns.status, ['created', 'queued', 'scheduled', 'running', 'waiting']),
      )
      .orderBy(asc(workflowRuns.createdAt));
    return rows.map(toWorkflowRun);
  }

  async update(id: RunId, patch: RunUpdate): Promise<WorkflowRun> {
    const [row] = await this.db
      .update(workflowRuns)
      .set({
        status: patch.status as RunStatus | undefined,
        branch: patch.branch,
        worktreePath: patch.worktreePath,
        threadId: patch.threadId,
        error: patch.error,
        diff: patch.diff,
        artifacts: patch.artifacts,
        totalTokens: patch.totalTokens,
        costUsd: patch.costUsd,
        updatedAt: new Date(),
      })
      .where(eq(workflowRuns.id, id))
      .returning();
    return toWorkflowRun(row);
  }

  async createNode(input: CreateRunNodeInput): Promise<RunNode> {
    const [row] = await this.db
      .insert(runNodes)
      .values({
        runId: input.runId,
        nodeKey: input.nodeKey,
        type: input.type,
        dependsOn: input.dependsOn,
        status: input.status ?? 'pending',
      })
      .returning();
    return toRunNode(row);
  }

  async listNodes(runId: RunId): Promise<RunNode[]> {
    const rows = await this.db
      .select()
      .from(runNodes)
      .where(eq(runNodes.runId, runId));
    return rows.map(toRunNode);
  }

  /**
   * Reset every non-completed node of a run back to `pending`, clearing its
   * error/output/timestamps. Completed nodes are preserved so a retry resumes
   * from the last successful step instead of redoing finished work.
   */
  async resetForRetry(runId: RunId): Promise<void> {
    await this.db
      .update(runNodes)
      .set({
        status: 'pending',
        error: null,
        output: null,
        attempts: null,
        timedOut: null,
        durationMs: null,
        startedAt: null,
        completedAt: null,
      })
      .where(and(eq(runNodes.runId, runId), ne(runNodes.status, 'completed')));
  }

  async updateNode(id: string, patch: Partial<Omit<RunNode, 'id' | 'runId'>>): Promise<RunNode> {
    const usage = patch.usage;
    const [row] = await this.db
      .update(runNodes)
      .set({
        status: patch.status as RunNodeStatus | undefined,
        input: patch.input,
        output: patch.output,
        error: patch.error,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
        cachedInputTokens: usage?.cachedInputTokens,
        costUsd: usage?.costUsd,
        attempts: patch.attempts,
        timedOut: patch.timedOut,
        durationMs: patch.durationMs,
        model: patch.model,
        agentId: patch.agentId,
        startedAt: patch.startedAt ? new Date(patch.startedAt) : undefined,
        completedAt: patch.completedAt ? new Date(patch.completedAt) : undefined,
      })
      .where(eq(runNodes.id, id))
      .returning();
    return toRunNode(row);
  }

  /**
   * Recompute and persist a run's usage totals by summing token/cost across all
   * of its nodes. Called after a node completes so the run row stays current.
   */
  async recomputeUsage(runId: RunId): Promise<void> {
    const [totals] = await this.db
      .select({
        totalTokens: sql<number>`coalesce(sum(${runNodes.totalTokens}), 0)`,
        costUsd: sql<number>`coalesce(sum(${runNodes.costUsd}), 0)`,
      })
      .from(runNodes)
      .where(eq(runNodes.runId, runId));

    await this.db
      .update(workflowRuns)
      .set({
        totalTokens: Number(totals?.totalTokens ?? 0),
        costUsd: Number(totals?.costUsd ?? 0),
        updatedAt: new Date(),
      })
      .where(eq(workflowRuns.id, runId));
  }
}
