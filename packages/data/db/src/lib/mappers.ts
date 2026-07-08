import type {
  BoardConnection,
  ChatMessage,
  ChatRole,
  ChatUsage,
  CodeChunk,
  CodeIndex,
  Conversation,
  IndexStatus,
  Label,
  Project,
  ProjectSourceKind,
  RunConfigSnapshot,
  RunEvaluation,
  RunEvent,
  RunNode,
  RunNodeUsage,
  Ticket,
  TicketPriority,
  TicketRelation,
  TicketRelationType,
  Trigger,
  TriggerType,
  WorkflowRun,
} from '@orion/models';
import type { TriggerAction } from '@orion/models';
import type { Provider } from '@orion/models';
import type { EvaluationRating, RunNodeStatus, RunStatus } from '@orion/models';
import type { WorkflowNodeType } from '@orion/models';
import type { TicketSource } from '@orion/models';
import type { RunEventType } from '@orion/models';
import type {
  boardConnections,
  chatMessages,
  codeChunks,
  codeIndexes,
  conversations,
  labels,
  projects,
  providers,
  runEvaluations,
  runEvents,
  runNodes,
  ticketRelations,
  tickets,
  triggers,
  workflowRuns,
} from './schema.js';

type ProjectRow = typeof projects.$inferSelect;
type ProviderRow = typeof providers.$inferSelect;
type TicketRow = typeof tickets.$inferSelect;
type LabelRow = typeof labels.$inferSelect;
type TicketRelationRow = typeof ticketRelations.$inferSelect;
type RunRow = typeof workflowRuns.$inferSelect;
type NodeRow = typeof runNodes.$inferSelect;
type EventRow = typeof runEvents.$inferSelect;
type EvaluationRow = typeof runEvaluations.$inferSelect;
type ConversationRow = typeof conversations.$inferSelect;
type ChatMessageRow = typeof chatMessages.$inferSelect;
type BoardConnectionRow = typeof boardConnections.$inferSelect;
type TriggerRow = typeof triggers.$inferSelect;
type CodeChunkRow = typeof codeChunks.$inferSelect;
type CodeIndexRow = typeof codeIndexes.$inferSelect;

const iso = (d: Date): string => d.toISOString();
const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

export function toProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    harness: opt(row.harness),
    baseUrl: opt(row.baseUrl),
    models: row.models,
    hasApiKey: Boolean(row.apiKey),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    sourceKind: row.sourceKind as ProjectSourceKind,
    repoUrl: row.repoUrl,
    rootPath: opt(row.rootPath),
    scmProvider: row.scmProvider,
    boardProvider: row.boardProvider,
    defaultBranch: row.defaultBranch,
    configPath: row.configPath,
    ticketCounter: row.counter,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toTicket(row: TicketRow, labelIds: string[] = []): Ticket {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    swimlane: row.swimlaneKey,
    agentId: opt(row.agentId),
    workflowName: opt(row.workflowName),
    priority: row.priority as TicketPriority,
    parentId: opt(row.parentId),
    labelIds,
    source: row.source as TicketSource,
    externalId: opt(row.externalId),
    order: row.position,
    displayKey: opt(row.displayKey),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toLabel(row: LabelRow): Label {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    color: row.color,
    createdAt: iso(row.createdAt),
  };
}

export function toTicketRelation(row: TicketRelationRow): TicketRelation {
  return {
    id: row.id,
    sourceTicketId: row.sourceTicketId,
    targetTicketId: row.targetTicketId,
    type: row.type as TicketRelationType,
    createdAt: iso(row.createdAt),
  };
}

export function toWorkflowRun(row: RunRow): WorkflowRun {
  return {
    id: row.id,
    ticketId: row.ticketId,
    projectId: row.projectId,
    workflowName: row.workflowName,
    status: row.status as RunStatus,
    branch: opt(row.branch),
    worktreePath: opt(row.worktreePath),
    threadId: opt(row.threadId),
    error: opt(row.error),
    diff: opt(row.diff),
    artifacts: row.artifacts ? (row.artifacts as WorkflowRun['artifacts']) : undefined,
    configSnapshot: row.configSnapshot
      ? (row.configSnapshot as unknown as RunConfigSnapshot)
      : undefined,
    durationMs: Math.max(0, row.updatedAt.getTime() - row.createdAt.getTime()),
    totalTokens: opt(row.totalTokens),
    costUsd: opt(row.costUsd),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toRunNode(row: NodeRow): RunNode {
  return {
    id: row.id,
    runId: row.runId,
    nodeKey: row.nodeKey,
    type: row.type as WorkflowNodeType,
    status: row.status as RunNodeStatus,
    dependsOn: row.dependsOn,
    input: opt(row.input),
    output: opt(row.output),
    error: opt(row.error),
    usage: toRunNodeUsage(row),
    attempts: opt(row.attempts),
    timedOut: opt(row.timedOut),
    durationMs:
      opt(row.durationMs) ??
      (row.startedAt && row.completedAt
        ? Math.max(0, row.completedAt.getTime() - row.startedAt.getTime())
        : undefined),
    model: opt(row.model),
    agentId: opt(row.agentId),
    structuredOutputValid: opt(row.structuredOutputValid),
    startedAt: row.startedAt ? iso(row.startedAt) : undefined,
    completedAt: row.completedAt ? iso(row.completedAt) : undefined,
  };
}

/** Build a `RunNodeUsage` only when the row carries at least one usage field. */
function toRunNodeUsage(row: NodeRow): RunNodeUsage | undefined {
  const { inputTokens, outputTokens, totalTokens, cachedInputTokens, costUsd } = row;
  if (
    inputTokens === null &&
    outputTokens === null &&
    totalTokens === null &&
    cachedInputTokens === null &&
    costUsd === null
  ) {
    return undefined;
  }
  return {
    inputTokens: opt(inputTokens),
    outputTokens: opt(outputTokens),
    totalTokens: opt(totalTokens),
    cachedInputTokens: opt(cachedInputTokens),
    costUsd: opt(costUsd),
  };
}

export function toRunEvent(row: EventRow): RunEvent {
  return {
    id: row.id,
    runId: row.runId,
    nodeId: opt(row.nodeId),
    type: row.type as RunEventType,
    payload: row.payload,
    createdAt: iso(row.createdAt),
  };
}

export function toRunEvaluation(row: EvaluationRow): RunEvaluation {
  return {
    id: row.id,
    runId: row.runId,
    projectId: row.projectId,
    nodeId: opt(row.nodeId),
    rating: row.rating as EvaluationRating,
    score: opt(row.score),
    evaluator: row.evaluator,
    labels: row.labels,
    comment: row.comment,
    metadata: row.metadata ? (row.metadata as Record<string, unknown>) : undefined,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as ChatRole,
    content: row.content,
    usage: toChatUsage(row),
    createdAt: iso(row.createdAt),
  };
}

/** Build a `ChatUsage` only when the row carries at least one usage field. */
function toChatUsage(row: ChatMessageRow): ChatUsage | undefined {
  const { inputTokens, outputTokens, totalTokens, costUsd } = row;
  if (inputTokens === null && outputTokens === null && totalTokens === null && costUsd === null) {
    return undefined;
  }
  return {
    inputTokens: opt(inputTokens),
    outputTokens: opt(outputTokens),
    totalTokens: opt(totalTokens),
    costUsd: opt(costUsd),
  };
}

export function toBoardConnection(row: BoardConnectionRow): BoardConnection {
  return {
    id: row.id,
    projectId: row.projectId,
    provider: row.provider,
    apiKey: row.apiKey,
    teamId: row.teamId,
    stateMap: row.stateMap,
    enabled: row.enabled,
    lastSyncedAt: row.lastSyncedAt ? iso(row.lastSyncedAt) : undefined,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toTrigger(row: TriggerRow): Trigger {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    type: row.type as TriggerType,
    enabled: row.enabled,
    action: row.action as TriggerAction,
    cron: opt(row.cron),
    webhookToken: opt(row.webhookToken),
    ticketTitle: opt(row.ticketTitle),
    ticketDescription: opt(row.ticketDescription),
    swimlane: opt(row.swimlaneKey),
    agentId: opt(row.agentId),
    prompt: opt(row.prompt),
    lastFiredAt: row.lastFiredAt ? iso(row.lastFiredAt) : undefined,
    nextFireAt: row.nextFireAt ? iso(row.nextFireAt) : undefined,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toCodeChunk(row: CodeChunkRow): CodeChunk {
  return {
    id: row.id,
    projectId: row.projectId,
    filePath: row.filePath,
    chunkIndex: row.chunkIndex,
    startLine: row.startLine,
    endLine: row.endLine,
    content: row.content,
    embedding: row.embedding,
    createdAt: iso(row.createdAt),
  };
}

export function toCodeIndex(row: CodeIndexRow): CodeIndex {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status as IndexStatus,
    provider: row.provider,
    dimensions: row.dimensions,
    fileCount: row.fileCount,
    chunkCount: row.chunkCount,
    error: opt(row.error),
    lastIndexedAt: row.lastIndexedAt ? iso(row.lastIndexedAt) : undefined,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
