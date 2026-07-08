import type { ProjectId } from './project.model.js';
import type { RunId, RunNodeId } from './run.model.js';

export type EvaluationId = string;

/** Coarse quality signal for a run or node. */
export type EvaluationRating = 'positive' | 'negative' | 'neutral';

/**
 * Who produced the evaluation. `human` for manual feedback in the UI, `auto`
 * for heuristics derived from telemetry, or a model id for LLM-as-judge grading.
 */
export type EvaluationEvaluator = string;

/**
 * A quality assessment of a run (or a specific node within it). Evaluations are
 * the ground-truth signal that drives agent improvement: pairing human/auto
 * judgments with the run telemetry and config snapshot lets us see which agents,
 * models and prompts perform well.
 */
export interface RunEvaluation {
  id: EvaluationId;
  runId: RunId;
  projectId: ProjectId;
  /** Node the evaluation targets; omit to evaluate the run as a whole. */
  nodeId?: RunNodeId;
  rating: EvaluationRating;
  /** Optional numeric quality score in the range [0, 1]. */
  score?: number;
  evaluator: EvaluationEvaluator;
  /** Free-form quality/failure tags, e.g. `['wrong-approach', 'flaky-test']`. */
  labels: string[];
  comment?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEvaluationInput {
  runId: RunId;
  nodeId?: RunNodeId;
  rating: EvaluationRating;
  score?: number;
  evaluator?: EvaluationEvaluator;
  labels?: string[];
  comment?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateEvaluationInput {
  rating?: EvaluationRating;
  score?: number;
  labels?: string[];
  comment?: string;
  metadata?: Record<string, unknown>;
}

/** Per-agent rollup mixing run telemetry with human/auto evaluations. */
export interface AgentScorecard {
  agentId: string;
  model?: string;
  /** How many agent-node executions were recorded for this agent. */
  nodeRuns: number;
  failures: number;
  /** Completed / total, as a percentage. */
  successRate: number;
  avgDurationMs: number | null;
  totalTokens: number;
  costUsd: number;
  positive: number;
  negative: number;
  /** Average evaluation score for this agent's nodes (0..1), or null. */
  avgScore: number | null;
}

/** Aggregated evaluation + telemetry metrics used to steer agent improvements. */
export interface EvaluationSummary {
  totalEvaluations: number;
  positive: number;
  negative: number;
  neutral: number;
  /** Average numeric score across evaluations that carry one (0..1). */
  averageScore: number | null;
  /** Most frequently applied quality/failure labels. */
  topLabels: Array<{ label: string; count: number }>;
  byAgent: AgentScorecard[];
}
