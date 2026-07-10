import type {
  ConditionBranch,
  HttpMethod,
  LoopConfig,
  MatrixConfig,
  McpServerMap,
  MessageTarget,
  NotificationLevel,
  WorkflowNodeConfig,
  WorkflowNodeType,
} from '@orion/models';

/**
 * The canonical, editor-facing shape of a single workflow node, shared by the
 * config editor and the visual builder so both surfaces author the exact same
 * set of fields. This intentionally mirrors {@link WorkflowNodeConfig} minus the
 * `id`/`dependsOn` graph plumbing (which each surface manages its own way — a
 * form list vs. canvas edges).
 *
 * NOTE: whenever you add a field here, wire it through {@link nodeConfigToData}
 * and {@link dataToNodeConfig} AND expose it in both surfaces' UI. The two pages
 * are required to stay at feature parity (see AGENTS.md).
 */
export interface NodeData {
  type: WorkflowNodeType;
  provider?: string;
  model?: string;
  baseUrl?: string;
  instructions?: string;
  workflow?: string;
  action?: string;
  /** For `scm` open_pull_request and `message` nodes: draft content with an agent. */
  agentGenerated?: boolean;
  script?: string;
  /** For `message` nodes: deliver as a notification or a ticket comment. */
  messageTarget?: MessageTarget;
  message?: string;
  level?: NotificationLevel;
  condition?: string;
  /** Ordered if/else-if/else branches for a `condition` node. */
  branches?: ConditionBranch[];
  url?: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  /** GraphQL document for `graphql` nodes. */
  query?: string;
  /** GraphQL variables (JSON object string) for `graphql` nodes. */
  variables?: string;
  token?: string;
  /** Free-form per-node configuration blob — SCM action params, notify channel overrides, etc. */
  config?: Record<string, unknown>;
  swimlane?: string;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  continueOnError?: boolean;
  loop?: LoopConfig;
  matrix?: MatrixConfig;
  skills?: string[];
  mcpServers?: McpServerMap;
}

/** Node types both surfaces let you author (everything except the internal `workflow` inline type). */
export const NODE_TYPES = [
  'agent',
  'shell',
  'approval',
  'scm',
  'message',
  'condition',
  'http',
  'graphql',
] as const satisfies readonly WorkflowNodeType[];

export type EditableNodeType = (typeof NODE_TYPES)[number];

/** Human-readable labels for each node type, shared across both surfaces. */
export const NODE_TYPE_LABELS: Record<EditableNodeType, string> = {
  agent: 'Agent — an AI turn',
  shell: 'Shell — a deterministic script',
  approval: 'Approval — a human gate',
  scm: 'SCM — source-control action',
  message: 'Message — notify or comment',
  condition: 'Condition — branch on an expression',
  http: 'HTTP — call an endpoint',
  graphql: 'GraphQL — run an operation',
};

/** One-line descriptions for each node type, shared across both surfaces. */
export const NODE_TYPE_DESCRIPTIONS: Record<EditableNodeType, string> = {
  agent: 'Runs an AI agent with a rendered command template. Streams messages and tool calls.',
  shell: 'Runs a deterministic script (tests, a linter, a build). No AI involved.',
  approval: 'Pauses the run in the chosen swimlane until a human approves it.',
  scm: 'Performs a source-control action such as opening a pull request.',
  message:
    'Sends a message — either a notification (Slack, webhook) or a comment on the run’s ticket.',
  condition:
    'Evaluates boolean expressions in order (if / else-if / else); the first truthy branch runs while the others are skipped.',
  http: 'Performs an HTTP request and captures the response for downstream nodes.',
  graphql: 'Runs a GraphQL query or mutation and captures the response data.',
};

/** SCM actions the engine currently supports for `scm` nodes. */
export const SCM_ACTIONS = [
  'checkout_branch',
  'open_pull_request',
  'tag_release',
  'merge',
  'review',
] as const;
export type ScmAction = (typeof SCM_ACTIONS)[number];

/** Human-readable labels for the supported SCM actions. */
export const SCM_ACTION_LABELS: Record<string, string> = {
  checkout_branch: 'Checkout branch',
  open_pull_request: 'Open pull request',
  tag_release: 'Tag / release',
  merge: 'Merge pull request',
  review: 'Request review',
};

/** A `WorkflowNodeConfig` that also tolerates deprecated `command` and `prompt`
 *  fields which may still be present in older config files. They are merged into
 *  `instructions` during parsing. */
export type WorkflowNodeConfigLike = WorkflowNodeConfig & {
  /** @deprecated Merged into `instructions`. */
  command?: string;
  /** @deprecated Merged into `instructions`. */
  prompt?: string;
};

/** Coerce an arbitrary config node type into a known one, defaulting to `agent`.
 *  Legacy `notify`/`comment` types are migrated to the unified `message` type. */
export function coerceNodeType(value: unknown): WorkflowNodeType {
  if (value === 'notify' || value === 'comment') return 'message';
  return (NODE_TYPES as readonly string[]).includes(value as string)
    ? (value as WorkflowNodeType)
    : 'agent';
}

/**
 * Read a persisted {@link WorkflowNodeConfig} into the shared editable
 * {@link NodeData} shape, merging deprecated `command`/`prompt` into
 * `instructions` and migrating legacy `notify`/`comment` node types into the
 * unified `message` type (with the appropriate `messageTarget`). This is the
 * single reader both surfaces use so parsing stays identical.
 */
export function nodeConfigToData(node: WorkflowNodeConfig): NodeData {
  const like = node as WorkflowNodeConfigLike;
  const rawType = node.type as string;
  const type = coerceNodeType(rawType);
  let messageTarget = node.messageTarget;
  if (type === 'message' && !messageTarget) {
    messageTarget = rawType === 'comment' ? 'comment' : 'notify';
  }
  return {
    type,
    provider: node.provider,
    model: node.model,
    baseUrl: node.baseUrl,
    instructions: node.instructions ?? like.command ?? like.prompt,
    workflow: node.workflow,
    action: node.action,
    agentGenerated: node.agentGenerated,
    script: node.script,
    messageTarget,
    message: node.message,
    level: node.level,
    condition: node.condition,
    branches: node.branches,
    url: node.url,
    method: node.method,
    headers: node.headers,
    body: node.body,
    query: node.query,
    variables: node.variables,
    token: node.token,
    config: node.config,
    swimlane: node.swimlane,
    retries: node.retries,
    retryDelayMs: node.retryDelayMs,
    timeoutMs: node.timeoutMs,
    continueOnError: node.continueOnError,
    loop: node.loop,
    matrix: node.matrix,
    skills: node.skills,
    mcpServers: node.mcpServers,
  };
}

const isType = (t: WorkflowNodeType) => (v: WorkflowNodeType) => v === t;

/**
 * Build a clean {@link WorkflowNodeConfig} from shared editable {@link NodeData},
 * dropping empties and fields irrelevant to the node's type. This is the single
 * writer both surfaces use so serialization stays identical.
 */
export function dataToNodeConfig(
  data: NodeData,
  id: string,
  dependsOn: string[],
): WorkflowNodeConfig {
  const isAgent = isType('agent')(data.type);
  const isShell = isType('shell')(data.type);
  const isScm = isType('scm')(data.type);
  const isMessage = isType('message')(data.type);
  const isCondition = isType('condition')(data.type);
  const isHttp = isType('http')(data.type);
  const isGraphql = isType('graphql')(data.type);
  const supportsRetryPolicy = isAgent || isHttp || isGraphql;
  const node: WorkflowNodeConfig = {
    id: id.trim(),
    type: data.type,
  };
  if (isAgent && data.provider?.trim()) node.provider = data.provider.trim();
  if (isAgent && data.model?.trim()) node.model = data.model.trim();
  if (isAgent && data.baseUrl?.trim()) node.baseUrl = data.baseUrl.trim();
  if (isAgent && data.instructions?.trim()) node.instructions = data.instructions.trim();
  if (isScm && data.action?.trim()) node.action = data.action.trim();
  if (isScm && data.action === 'open_pull_request' && data.agentGenerated) {
    node.agentGenerated = true;
  }
  if (isShell && data.script?.trim()) node.script = data.script.trim();
  if (isMessage) {
    node.messageTarget = data.messageTarget ?? 'notify';
    if (data.agentGenerated) node.agentGenerated = true;
    if (data.message?.trim()) node.message = data.message.trim();
    if (node.messageTarget === 'notify') {
      if (data.provider?.trim()) node.provider = data.provider.trim();
      if (data.level) node.level = data.level;
    } else if (data.provider?.trim()) {
      node.provider = data.provider.trim();
    }
  }
  if (isCondition && data.condition?.trim()) node.condition = data.condition.trim();
  if (isCondition && data.branches?.length) node.branches = data.branches;
  if ((isHttp || isGraphql) && data.url?.trim()) node.url = data.url.trim();
  if (isHttp && data.method) node.method = data.method;
  if ((isHttp || isGraphql) && data.headers && Object.keys(data.headers).length > 0) {
    node.headers = data.headers;
  }
  if (isHttp && data.body?.trim()) node.body = data.body.trim();
  if (isGraphql && data.query?.trim()) node.query = data.query.trim();
  if (isGraphql && data.variables?.trim()) node.variables = data.variables.trim();
  if ((isHttp || isGraphql) && data.token?.trim()) node.token = data.token.trim();
  if (data.swimlane?.trim()) node.swimlane = data.swimlane.trim();
  if (supportsRetryPolicy && typeof data.retries === 'number') node.retries = data.retries;
  if (supportsRetryPolicy && typeof data.retryDelayMs === 'number') {
    node.retryDelayMs = data.retryDelayMs;
  }
  if (supportsRetryPolicy && typeof data.timeoutMs === 'number') node.timeoutMs = data.timeoutMs;
  if (data.continueOnError) node.continueOnError = true;
  if (data.loop && isAgent) node.loop = data.loop;
  if (data.matrix && (isAgent || isShell)) node.matrix = data.matrix;
  if (isAgent && data.skills?.length) node.skills = data.skills;
  if (isAgent && data.mcpServers && Object.keys(data.mcpServers).length > 0) {
    node.mcpServers = data.mcpServers;
  }
  if (data.config && Object.keys(data.config).length > 0) {
    node.config = data.config;
  }
  if (dependsOn.length) node.dependsOn = dependsOn;
  return node;
}

/**
 * Per-node semantic validation shared by both surfaces so their inline warnings
 * stay in lock-step. `id` is the resolved node id for messaging.
 */
export function validateNodeData(data: NodeData, id: string): string[] {
  const issues: string[] = [];
  const label = id.trim() || '(unnamed)';
  if (data.type === 'agent' && !data.provider?.trim()) {
    issues.push(`Node "${label}" is an agent node but has no provider.`);
  }
  if (data.type === 'scm' && !data.action?.trim()) {
    issues.push(`Node "${label}" is an scm node but has no action.`);
  }
  if (data.type === 'shell' && !data.script?.trim()) {
    issues.push(`Node "${label}" is a shell node but has no script.`);
  }
  if (data.type === 'message' && !data.agentGenerated && !data.message?.trim()) {
    issues.push(`Node "${label}" is a message node but has no message.`);
  }
  if (data.type === 'condition' && !data.condition?.trim() && !data.branches?.length) {
    issues.push(
      `Node "${label}" is a condition node but has no condition expression or branches.`,
    );
  }
  if (data.type === 'http' && !data.url?.trim()) {
    issues.push(`Node "${label}" is an http node but has no url.`);
  }
  if (data.type === 'graphql') {
    if (!data.url?.trim()) issues.push(`Node "${label}" is a graphql node but has no url.`);
    if (!data.query?.trim()) issues.push(`Node "${label}" is a graphql node but has no query.`);
  }
  if (data.loop && data.matrix) {
    issues.push(`Node "${label}" cannot combine a loop with a matrix.`);
  }
  return issues;
}

/** Build the default instructions file path for an agent node id. */
export function defaultInstructionsPath(id: string): string {
  const trimmed = id.trim();
  return trimmed ? `instructions/${trimmed}.md` : '';
}
