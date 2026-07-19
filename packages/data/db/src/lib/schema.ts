import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { McpServerConfig } from '@orion/models';

export const providers = pgTable('providers', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Model provider identifier, e.g. `openai`, `deepseek`. */
  key: text('key').notNull(),
  /** SDK runtime harness: `codex`, `claude`, `opencode`. */
  harness: text('harness'),
  /** Human-friendly display name, e.g. `DeepSeek`. */
  label: text('label').notNull().default(''),
  /** Optional default OpenAI-compatible base URL for this provider. */
  baseUrl: text('base_url'),
  /** Encrypted model provider API key. Nullable; empty = not set. */
  apiKey: text('api_key'),
  /** Model identifiers available for this provider. */
  models: jsonb('models').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  sourceKind: text('source_kind').notNull().default('remote'),
  repoUrl: text('repo_url').notNull().default(''),
  rootPath: text('root_path'),
  scmProvider: text('scm_provider').notNull().default('github'),
  boardProvider: text('board_provider').notNull().default('native'),
  defaultBranch: text('default_branch').notNull().default('main'),
  configPath: text('config_path').notNull().default('.orion/config.yaml'),
  counter: integer('counter').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const epics = pgTable('epics', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  color: text('color').notNull().default('#7c3aed'),
  externalId: text('external_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tickets = pgTable('tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  swimlaneKey: text('swimlane_key').notNull(),
  agentId: text('agent_id'),
  /** Workflow name this ticket is bound to; drives sub-swimlane placement. */
  workflowName: text('workflow_name'),
  priority: integer('priority').notNull().default(0),
  parentId: uuid('parent_id').references((): AnyPgColumn => tickets.id, {
    onDelete: 'set null',
  }),
  source: text('source').notNull().default('native'),
  externalId: text('external_id'),
  position: integer('position').notNull().default(0),
  /** JIRA-style display key, e.g. ORION-42. Auto-generated from project name + counter. */
  displayKey: text('display_key'),
  /** The kind of work this ticket represents: feature, bug, issue, hotfix, or epic. */
  type: text('type').notNull().default('feature'),
  /** Optional start date for timeline bar placement. */
  startDate: timestamp('start_date', { withTimezone: true }),
  /** Optional due date for scheduling and timeline views. */
  dueDate: timestamp('due_date', { withTimezone: true }),
  /** Optional epic ticket this ticket belongs to. Must be a ticket with type='epic'. */
  epicId: uuid('epic_id').references((): AnyPgColumn => tickets.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const labels = pgTable('labels', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ticketLabels = pgTable(
  'ticket_labels',
  {
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.ticketId, table.labelId] })],
);

export const ticketRelations = pgTable('ticket_relations', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceTicketId: uuid('source_ticket_id')
    .notNull()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  targetTicketId: uuid('target_ticket_id')
    .notNull()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowRuns = pgTable('workflow_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  workflowName: text('workflow_name').notNull(),
  status: text('status').notNull().default('created'),
  branch: text('branch'),
  worktreePath: text('worktree_path'),
  threadId: text('thread_id'),
  error: text('error'),
  diff: text('diff'),
  artifacts: jsonb('artifacts').$type<{ nodeOutputs: Record<string, unknown>; aggregatedLogs?: string }>(),
  /** Snapshot of the workflow + agents that produced this run (for evaluations). */
  configSnapshot: jsonb('config_snapshot').$type<Record<string, unknown>>(),
  totalTokens: integer('total_tokens').default(0),
  costUsd: doublePrecision('cost_usd').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const runNodes = pgTable('run_nodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id')
    .notNull()
    .references(() => workflowRuns.id, { onDelete: 'cascade' }),
  nodeKey: text('node_key').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull().default('pending'),
  dependsOn: jsonb('depends_on').$type<string[]>().notNull().default([]),
  input: jsonb('input'),
  output: jsonb('output'),
  error: text('error'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  cachedInputTokens: integer('cached_input_tokens'),
  costUsd: doublePrecision('cost_usd'),
  /** Executor attempts made (1 = succeeded first try, >1 = retried). */
  attempts: integer('attempts'),
  /** True when the final attempt was aborted by the node's timeout. */
  timedOut: boolean('timed_out'),
  /** Wall-clock duration of the node in milliseconds. */
  durationMs: integer('duration_ms'),
  /** Model the agent node ran with (agent nodes only). */
  model: text('model'),
  /** Agent id the node ran as (agent nodes only). */
  agentId: text('agent_id'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const runEvents = pgTable('run_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id')
    .notNull()
    .references(() => workflowRuns.id, { onDelete: 'cascade' }),
  nodeId: uuid('node_id'),
  type: text('type').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Quality assessments of runs/nodes — the ground-truth signal for agent
 * improvement. Rows pair a human or automated judgment with a run (and
 * optionally a specific node) so telemetry can be sliced by outcome quality.
 */
export const runEvaluations = pgTable(
  'run_evaluations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Optional node being evaluated; null means the whole run. */
    nodeId: uuid('node_id').references(() => runNodes.id, { onDelete: 'cascade' }),
    /** `positive | negative | neutral`. */
    rating: text('rating').notNull().default('neutral'),
    /** Optional numeric quality score in [0, 1]. */
    score: doublePrecision('score'),
    /** `human`, `auto`, or a model id for LLM-as-judge. */
    evaluator: text('evaluator').notNull().default('human'),
    labels: jsonb('labels').$type<string[]>().notNull().default([]),
    comment: text('comment').notNull().default(''),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('run_evaluations_run_id_idx').on(table.runId),
    index('run_evaluations_project_id_idx').on(table.projectId),
  ],
);

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('New conversation'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull().default(''),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  costUsd: doublePrecision('cost_usd'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const boardConnections = pgTable('board_connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('linear'),
  apiKey: text('api_key').notNull().default(''),
  teamId: text('team_id').notNull().default(''),
  /** Non-secret provider extras (Jira base url/email, Trello api key, ...). */
  config: jsonb('config').$type<Record<string, string>>().notNull().default({}),
  stateMap: jsonb('state_map').$type<Record<string, string>>().notNull().default({}),
  /** `pull` | `push` | `both`. */
  direction: text('direction').notNull().default('both'),
  /** Push a ticket's state upstream immediately when it moves locally. */
  autoPush: boolean('auto_push').notNull().default(true),
  /** Import remote issues that don't yet exist locally. */
  importNew: boolean('import_new').notNull().default(true),
  /** Update local tickets when their remote source changes. */
  updateExisting: boolean('update_existing').notNull().default(true),
  /** Per-connection sync cadence in ms; null falls back to the global default. */
  syncIntervalMs: integer('sync_interval_ms'),
  enabled: boolean('enabled').notNull().default(true),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const boardSyncLogs = pgTable('board_sync_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  status: text('status').notNull(),
  imported: integer('imported').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  epicsLinked: integer('epics_linked').notNull().default(0),
  error: text('error'),
  durationMs: integer('duration_ms').notNull().default(0),
  trigger: text('trigger').notNull().default('manual'),
});

export const schedules = pgTable('schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  /** Standard 5-field cron expression. */
  cron: text('cron').notNull(),
  /** Custom instruction the agent runs on each fire. */
  instruction: text('instruction').notNull(),
  /** Skill names to materialize for the agent (project skill catalog). */
  skills: jsonb('skills').$type<string[]>().notNull().default([]),
  /** Registered MCP server names to expose to the agent (project config). */
  mcpServers: jsonb('mcp_servers').$type<string[]>().notNull().default([]),
  /**
   * Inline MCP server definitions keyed by name, captured for selected servers
   * (e.g. global ones) that are not present in the project config.
   */
  mcpServerConfigs: jsonb('mcp_server_configs')
    .$type<Record<string, McpServerConfig>>()
    .notNull()
    .default({}),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  nextFireAt: timestamp('next_fire_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-chunk embeddings for a project's codebase index. Embeddings are stored as
 * a JSON `number[]` so cosine similarity can be computed in JS — no pgvector
 * extension is required, which keeps Postgres and embedded PGlite in sync.
 * (This can be upgraded to a pgvector column later without changing callers.)
 */
export const codeChunks = pgTable(
  'code_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    content: text('content').notNull(),
    embedding: jsonb('embedding').$type<number[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('code_chunks_project_id_idx').on(table.projectId)],
);

export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  config: jsonb('config').$type<McpServerConfig>().notNull(),
  authType: text('auth_type').notNull().default('none'),
  oauth: jsonb('oauth').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable('app_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  branding: jsonb('branding').$type<Record<string, unknown>>().notNull().default({}),
  preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Status + metadata of a project's codebase index (one row per project). */
export const codeIndexes = pgTable('code_indexes', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  /** `idle | indexing | ready | error`. */
  status: text('status').notNull().default('idle'),
  /** Embedding provider id, e.g. `local` or `openai:text-embedding-3-small`. */
  provider: text('provider').notNull().default(''),
  dimensions: integer('dimensions').notNull().default(0),
  fileCount: integer('file_count').notNull().default(0),
  chunkCount: integer('chunk_count').notNull().default(0),
  error: text('error'),
  lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
