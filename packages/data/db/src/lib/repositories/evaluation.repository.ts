import { and, desc, eq, gte, isNotNull, sql, type SQL } from 'drizzle-orm';
import type {
  AgentScorecard,
  CreateEvaluationInput,
  EvaluationSummary,
  RunEvaluation,
  UpdateEvaluationInput,
} from '@orion/models';
import type { Database } from '../client.js';
import { runEvaluations, runNodes, workflowRuns } from '../schema.js';
import { toRunEvaluation } from '../mappers.js';

export interface EvaluationListFilter {
  projectId?: string;
  runId?: string;
  nodeId?: string;
  limit?: number;
}

export interface EvaluationSummaryFilter {
  projectId?: string;
  days?: number;
}

/**
 * Data access for run/node evaluations plus the aggregate metrics that combine
 * human/auto judgments with run telemetry to steer agent improvement.
 */
export class EvaluationRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateEvaluationInput & { projectId: string }): Promise<RunEvaluation> {
    const [row] = await this.db
      .insert(runEvaluations)
      .values({
        runId: input.runId,
        projectId: input.projectId,
        nodeId: input.nodeId ?? null,
        rating: input.rating,
        score: input.score,
        evaluator: input.evaluator ?? 'human',
        labels: input.labels ?? [],
        comment: input.comment ?? '',
        metadata: input.metadata,
      })
      .returning();
    return toRunEvaluation(row);
  }

  async get(id: string): Promise<RunEvaluation | null> {
    const [row] = await this.db.select().from(runEvaluations).where(eq(runEvaluations.id, id));
    return row ? toRunEvaluation(row) : null;
  }

  async list(filter?: EvaluationListFilter): Promise<RunEvaluation[]> {
    const conditions: SQL<unknown>[] = [];
    if (filter?.projectId) conditions.push(eq(runEvaluations.projectId, filter.projectId));
    if (filter?.runId) conditions.push(eq(runEvaluations.runId, filter.runId));
    if (filter?.nodeId) conditions.push(eq(runEvaluations.nodeId, filter.nodeId));
    const rows = await this.db
      .select()
      .from(runEvaluations)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(runEvaluations.createdAt))
      .limit(filter?.limit ?? 200);
    return rows.map(toRunEvaluation);
  }

  async update(id: string, patch: UpdateEvaluationInput): Promise<RunEvaluation> {
    const [row] = await this.db
      .update(runEvaluations)
      .set({
        rating: patch.rating,
        score: patch.score,
        labels: patch.labels,
        comment: patch.comment,
        metadata: patch.metadata,
        updatedAt: new Date(),
      })
      .where(eq(runEvaluations.id, id))
      .returning();
    return toRunEvaluation(row);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(runEvaluations)
      .where(eq(runEvaluations.id, id))
      .returning({ id: runEvaluations.id });
    return rows.length > 0;
  }

  /**
   * Aggregate metrics for the evaluations dashboard: rating distribution, top
   * labels, and a per-agent scorecard that blends agent-node telemetry with the
   * evaluations attached to those nodes.
   */
  async summary(filter?: EvaluationSummaryFilter): Promise<EvaluationSummary> {
    const since = filter?.days
      ? new Date(Date.now() - filter.days * 24 * 60 * 60 * 1000)
      : undefined;

    const evalConditions: SQL<unknown>[] = [];
    if (filter?.projectId) evalConditions.push(eq(runEvaluations.projectId, filter.projectId));
    if (since) evalConditions.push(gte(runEvaluations.createdAt, since));
    const evalWhere = evalConditions.length > 0 ? and(...evalConditions) : undefined;

    const [ratings] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        positive: sql<number>`count(*) filter (where ${runEvaluations.rating} = 'positive')::int`,
        negative: sql<number>`count(*) filter (where ${runEvaluations.rating} = 'negative')::int`,
        neutral: sql<number>`count(*) filter (where ${runEvaluations.rating} = 'neutral')::int`,
        avgScore: sql<number | null>`avg(${runEvaluations.score})`,
      })
      .from(runEvaluations)
      .where(evalWhere);

    // Top labels: unnest the jsonb array and count occurrences.
    const labelRows = await this.db
      .select({
        label: sql<string>`label_value`,
        count: sql<number>`count(*)::int`,
      })
      .from(
        sql`${runEvaluations}, jsonb_array_elements_text(${runEvaluations.labels}) as label_value`,
      )
      .where(evalWhere)
      .groupBy(sql`label_value`)
      .orderBy(sql`count(*) desc`)
      .limit(15);

    // Per-agent telemetry rollup over agent nodes.
    const nodeConditions: SQL<unknown>[] = [isNotNull(runNodes.agentId)];
    if (filter?.projectId) nodeConditions.push(eq(workflowRuns.projectId, filter.projectId));
    if (since) nodeConditions.push(gte(runNodes.startedAt, since));

    const agentRows = await this.db
      .select({
        agentId: runNodes.agentId,
        model: sql<string | null>`max(${runNodes.model})`,
        nodeRuns: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${runNodes.status} = 'completed')::int`,
        failures: sql<number>`count(*) filter (where ${runNodes.status} = 'failed')::int`,
        avgDurationMs: sql<number | null>`avg(${runNodes.durationMs})`,
        totalTokens: sql<number>`coalesce(sum(${runNodes.totalTokens}), 0)`,
        costUsd: sql<number>`coalesce(sum(${runNodes.costUsd}), 0)`,
      })
      .from(runNodes)
      .innerJoin(workflowRuns, eq(runNodes.runId, workflowRuns.id))
      .where(and(...nodeConditions))
      .groupBy(runNodes.agentId);

    // Evaluations attributed to each agent (via the evaluated node).
    const agentEvalConditions: SQL<unknown>[] = [isNotNull(runNodes.agentId)];
    if (filter?.projectId) agentEvalConditions.push(eq(runEvaluations.projectId, filter.projectId));
    if (since) agentEvalConditions.push(gte(runEvaluations.createdAt, since));

    const agentEvalRows = await this.db
      .select({
        agentId: runNodes.agentId,
        positive: sql<number>`count(*) filter (where ${runEvaluations.rating} = 'positive')::int`,
        negative: sql<number>`count(*) filter (where ${runEvaluations.rating} = 'negative')::int`,
        avgScore: sql<number | null>`avg(${runEvaluations.score})`,
      })
      .from(runEvaluations)
      .innerJoin(runNodes, eq(runEvaluations.nodeId, runNodes.id))
      .where(and(...agentEvalConditions))
      .groupBy(runNodes.agentId);

    const evalByAgent = new Map(agentEvalRows.map((r) => [r.agentId, r]));

    const byAgent: AgentScorecard[] = agentRows
      .filter((r): r is typeof r & { agentId: string } => r.agentId != null)
      .map((r) => {
        const evals = evalByAgent.get(r.agentId);
        const nodeRuns = Number(r.nodeRuns);
        const completed = Number(r.completed);
        return {
          agentId: r.agentId,
          model: r.model ?? undefined,
          nodeRuns,
          failures: Number(r.failures),
          successRate: nodeRuns > 0 ? Math.round((completed / nodeRuns) * 10000) / 100 : 0,
          avgDurationMs: r.avgDurationMs != null ? Math.round(Number(r.avgDurationMs)) : null,
          totalTokens: Number(r.totalTokens),
          costUsd: Number(r.costUsd),
          positive: evals ? Number(evals.positive) : 0,
          negative: evals ? Number(evals.negative) : 0,
          avgScore: evals?.avgScore != null ? Math.round(Number(evals.avgScore) * 100) / 100 : null,
        };
      })
      .sort((a, b) => b.nodeRuns - a.nodeRuns);

    return {
      totalEvaluations: Number(ratings?.total ?? 0),
      positive: Number(ratings?.positive ?? 0),
      negative: Number(ratings?.negative ?? 0),
      neutral: Number(ratings?.neutral ?? 0),
      averageScore:
        ratings?.avgScore != null ? Math.round(Number(ratings.avgScore) * 100) / 100 : null,
      topLabels: labelRows.map((r) => ({ label: r.label, count: Number(r.count) })),
      byAgent,
    };
  }
}
