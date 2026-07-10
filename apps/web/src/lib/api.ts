import type {
  ApiResponse,
  AppBranding,
  AppPreferences,
  AppSettings,
  Board,
  BoardConfig,
  ChatMessage,
  CodeIndex,
  Conversation,
  ConversationDetail,
  CreateEvaluationInput,
  CreateMcpServerInput,
  CreateProjectInput,
  CreateProviderInput,
  CreateTicketInput,
  CreateScheduleInput,
  EvaluationSummary,
  InstallSkillInput,
  InstallSkillResult,
  Label,
  McpServer,
  Project,
  Provider,
  RunEvaluation,
  RunEvent,
  RunNode,
  SearchResult,
  RecommendedSkill,
  SkillCatalogEntry,
  SkillDetail,
  SkillReference,
  SyncSkillResult,
  Ticket,
  TicketDetail,
  TicketRelation,
  TicketRelationKind,
  Schedule,
  ScheduleOptions,
  UpdateEvaluationInput,
  UpdateMcpServerInput,
  UpdateProjectInput,
  UpdateProviderInput,
  UpdateSkillInput,
  UpdateTicketInput,
  UpdateScheduleInput,
  WorkflowConfig,
  WorkflowRouteResult,
  WorkflowRun,
  WorkflowTemplateSummary,
} from '@orion/models';

const DEFAULT_API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api';
const API_URL_STORAGE_KEY = 'orion-api-url';

/** Resolve the orchestrator API base URL, preferring a user override. */
export function getApiBaseUrl(): string {
  try {
    const override = localStorage.getItem(API_URL_STORAGE_KEY);
    if (override && override.trim()) return override.trim();
  } catch {
    // ignore
  }
  return DEFAULT_API_URL;
}

/** Persist a user override for the API base URL. Pass null/empty to reset. */
export function setApiBaseUrl(url: string | null): void {
  try {
    if (url && url.trim() && url.trim() !== DEFAULT_API_URL) {
      localStorage.setItem(API_URL_STORAGE_KEY, url.trim());
    } else {
      localStorage.removeItem(API_URL_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function getDefaultApiBaseUrl(): string {
  return DEFAULT_API_URL;
}

/** Ping the orchestrator's `/health` endpoint to verify connectivity. */
export async function pingApi(url?: string): Promise<boolean> {
  const base = (url ?? getApiBaseUrl()).replace(/\/api\/?$/, '');
  try {
    const response = await fetch(`${base}/health`);
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: string };
    return body.status === 'ok';
  } catch {
    return false;
  }
}

export interface ProjectConfigResponse {
  board: BoardConfig;
  workflow: WorkflowConfig;
  /** Names of reusable sub-workflows referenced by `workflow` nodes. */
  workflows?: string[];
}

export interface RawConfigResponse {
  content: string | null;
  configPath: string;
}

export interface CommandFileResponse {
  content: string | null;
  path: string;
}

export interface DirEntry {
  name: string;
  path: string;
}

export interface DirListing {
  root: string;
  dir: string;
  entries: DirEntry[];
}

export interface WorkflowTemplateDetail {
  name: string;
  title: string;
  description: string;
  /** The template's `workflow:` block serialized to YAML text. */
  yaml: string;
  suggestedSwimlanes: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !body.success) {
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return body.data;
}

export const api = {
  listDirectories: (path: string) =>
    request<DirListing>(`/fs/dirs?path=${encodeURIComponent(path)}`),
  listWorkflowTemplates: () =>
    request<WorkflowTemplateSummary[]>('/workflows/templates'),
  getWorkflowTemplate: (name: string) =>
    request<WorkflowTemplateDetail>(`/workflows/templates/${encodeURIComponent(name)}`),
  listProviders: () => request<Provider[]>('/providers'),
  createProvider: (input: CreateProviderInput) =>
    request<Provider>('/providers', { method: 'POST', body: JSON.stringify(input) }),
  updateProvider: (id: string, input: UpdateProviderInput) =>
    request<Provider>(`/providers/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteProvider: (id: string) =>
    request<{ deleted: boolean }>(`/providers/${id}`, { method: 'DELETE' }),
  listProjects: () => request<Project[]>('/projects'),
  createProject: (input: CreateProjectInput) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  updateProject: (id: string, input: UpdateProjectInput) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteProject: (id: string) =>
    request<{ deleted: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
  getProjectConfig: (id: string) => request<ProjectConfigResponse>(`/projects/${id}/config`),
  getRawConfig: (id: string) => request<RawConfigResponse>(`/projects/${id}/config/raw`),
  saveRawConfig: (id: string, content: string) =>
    request<ProjectConfigResponse>(`/projects/${id}/config/raw`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  encryptSecret: (value: string) =>
    request<{ value: string; encrypted: boolean }>(`/config/encrypt-secret`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    }),
  listCommandFiles: (id: string) =>
    request<{ files: string[] }>(`/projects/${id}/commands`),
  getCommandFile: (id: string, path: string) =>
    request<CommandFileResponse>(`/projects/${id}/command?path=${encodeURIComponent(path)}`),
  saveCommandFile: (id: string, path: string, content: string) =>
    request<{ path: string }>(`/projects/${id}/command`, {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    }),
  getBoard: (id: string) => request<Board>(`/projects/${id}/board`),
  createTicket: (
    projectId: string,
    input: Omit<CreateTicketInput, 'projectId'>,
  ) =>
    request<Ticket>(`/projects/${projectId}/tickets`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTicket: (ticketId: string, input: UpdateTicketInput) =>
    request<Ticket>(`/tickets/${ticketId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  getTicketDetail: (ticketId: string) =>
    request<TicketDetail>(`/tickets/${ticketId}/detail`),
  listAllTickets: () => request<Ticket[]>('/tickets'),
  listAllLabels: () => request<Label[]>('/labels'),
  listLabels: (projectId: string) => request<Label[]>(`/projects/${projectId}/labels`),
  createLabel: (projectId: string, input: { name: string; color?: string }) =>
    request<Label>(`/projects/${projectId}/labels`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteLabel: (labelId: string) =>
    request<{ deleted: boolean }>(`/labels/${labelId}`, { method: 'DELETE' }),
  addTicketRelation: (ticketId: string, kind: TicketRelationKind, relatedTicketId: string) =>
    request<TicketRelation>(`/tickets/${ticketId}/relations`, {
      method: 'POST',
      body: JSON.stringify({ kind, ticketId: relatedTicketId }),
    }),
  removeTicketRelation: (relationId: string) =>
    request<{ deleted: boolean }>(`/ticket-relations/${relationId}`, { method: 'DELETE' }),
  moveTicket: (ticketId: string, swimlane: string, order?: number, workflowName?: string) =>
    request<Ticket>(`/tickets/${ticketId}/move`, {
      method: 'POST',
      body: JSON.stringify({ swimlane, order, workflowName }),
    }),
  setTicketAgent: (ticketId: string, agentId: string | null) =>
    request<Ticket>(`/tickets/${ticketId}/agent`, {
      method: 'POST',
      body: JSON.stringify({ agentId }),
    }),
  startRun: (ticketId: string) =>
    request<WorkflowRun>(`/tickets/${ticketId}/run`, { method: 'POST' }),
  listTicketRuns: (ticketId: string) => request<WorkflowRun[]>(`/tickets/${ticketId}/runs`),
  getRun: (runId: string) => request<{ run: WorkflowRun; nodes: RunNode[] }>(`/runs/${runId}`),
  listRunEvents: (runId: string) => request<RunEvent[]>(`/runs/${runId}/events`),
  approveRun: (runId: string, nodeKey: string) =>
    request<WorkflowRun>(`/runs/${runId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ nodeKey }),
    }),
  cancelRun: (runId: string) => request<{ cancelled: boolean }>(`/runs/${runId}/cancel`, { method: 'POST' }),
  retryRun: (runId: string) =>
    request<WorkflowRun>(`/runs/${runId}/retry`, { method: 'POST' }),
  listConversations: (projectId: string) =>
    request<Conversation[]>(`/projects/${projectId}/conversations`),
  createConversation: (projectId: string, title?: string) =>
    request<Conversation>(`/projects/${projectId}/conversations`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  getConversation: (conversationId: string) =>
    request<ConversationDetail>(`/conversations/${conversationId}`),
  sendChatMessage: (conversationId: string, content: string) =>
    request<ChatMessage>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  routeMessage: (projectId: string, message: string) =>
    request<WorkflowRouteResult>(`/projects/${projectId}/route`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  listSchedules: (projectId: string) => request<Schedule[]>(`/projects/${projectId}/schedules`),
  listAllSchedules: () => request<Schedule[]>('/schedules'),
  listScheduleOptions: (projectId: string) =>
    request<ScheduleOptions>(`/projects/${projectId}/schedules/options`),
  createSchedule: (projectId: string, input: Omit<CreateScheduleInput, 'projectId'>) =>
    request<Schedule>(`/projects/${projectId}/schedules`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateSchedule: (id: string, input: UpdateScheduleInput) =>
    request<Schedule>(`/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteSchedule: (id: string) =>
    request<{ deleted: boolean }>(`/schedules/${id}`, { method: 'DELETE' }),
  fireSchedule: (id: string) =>
    request<{ agentResponse: string }>(`/schedules/${id}/fire`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  getBoardConnection: (projectId: string) =>
    request<BoardConnectionResponse>(`/projects/${projectId}/board-connection`),
  saveBoardConnection: (
    projectId: string,
    input: BoardConnectionInput,
  ) =>
    request<BoardConnectionResponse>(`/projects/${projectId}/board-connection`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteBoardConnection: (projectId: string) =>
    request<{ deleted: boolean }>(`/projects/${projectId}/board-connection`, { method: 'DELETE' }),
  syncBoardConnection: (projectId: string) =>
    request<SyncSummary>(`/projects/${projectId}/board-connection/sync`, { method: 'POST' }),
  listBoardContainers: (
    projectId: string,
    opts: { provider?: string; apiKey?: string; config?: Record<string, string> },
  ) => {
    const qs = new URLSearchParams();
    if (opts.provider) qs.set('provider', opts.provider);
    if (opts.apiKey) qs.set('apiKey', opts.apiKey);
    if (opts.config && Object.keys(opts.config).length) qs.set('config', JSON.stringify(opts.config));
    return request<RemoteContainer[]>(
      `/projects/${projectId}/board-connection/containers?${qs.toString()}`,
    );
  },
  listBoardStates: (
    projectId: string,
    teamId: string,
    opts: { provider?: string; apiKey?: string; config?: Record<string, string> },
  ) => {
    const qs = new URLSearchParams();
    qs.set('teamId', teamId);
    if (opts.provider) qs.set('provider', opts.provider);
    if (opts.apiKey) qs.set('apiKey', opts.apiKey);
    if (opts.config && Object.keys(opts.config).length) qs.set('config', JSON.stringify(opts.config));
    return request<RemoteState[]>(
      `/projects/${projectId}/board-connection/states?${qs.toString()}`,
    );
  },
  listRuns: (params?: { projectId?: string; status?: string; from?: string; to?: string; search?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.projectId) qs.set('projectId', params.projectId);
    if (params?.status) qs.set('status', params.status);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return request<RunListItem[]>(`/runs${query ? `?${query}` : ''}`);
  },
  getAnalytics: (params?: { projectId?: string; days?: number }) => {
    const qs = new URLSearchParams();
    if (params?.projectId) qs.set('projectId', params.projectId);
    if (params?.days) qs.set('days', String(params.days));
    const query = qs.toString();
    return request<RunAnalytics>(`/analytics${query ? `?${query}` : ''}`);
  },
  getEvaluationSummary: (params?: { projectId?: string; days?: number }) => {
    const qs = new URLSearchParams();
    if (params?.projectId) qs.set('projectId', params.projectId);
    if (params?.days) qs.set('days', String(params.days));
    const query = qs.toString();
    return request<EvaluationSummary>(`/evaluations/summary${query ? `?${query}` : ''}`);
  },
  listProjectEvaluations: (projectId: string, limit?: number) => {
    const qs = new URLSearchParams();
    if (limit) qs.set('limit', String(limit));
    const query = qs.toString();
    return request<RunEvaluation[]>(`/projects/${projectId}/evaluations${query ? `?${query}` : ''}`);
  },
  listRunEvaluations: (runId: string) =>
    request<RunEvaluation[]>(`/runs/${runId}/evaluations`),
  createEvaluation: (runId: string, input: Omit<CreateEvaluationInput, 'runId'>) =>
    request<RunEvaluation>(`/runs/${runId}/evaluations`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateEvaluation: (id: string, input: UpdateEvaluationInput) =>
    request<RunEvaluation>(`/evaluations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteEvaluation: (id: string) =>
    request<{ deleted: boolean }>(`/evaluations/${id}`, { method: 'DELETE' }),
  getCodeIndex: (projectId: string) => request<CodeIndex>(`/projects/${projectId}/index`),
  reindexCodebase: (projectId: string) =>
    request<CodeIndex>(`/projects/${projectId}/index`, { method: 'POST' }),
  searchCodebase: (projectId: string, query: string, topK?: number) =>
    request<SearchResult[]>(`/projects/${projectId}/search`, {
      method: 'POST',
      body: JSON.stringify({ query, topK }),
    }),
  listSkills: (projectId: string) =>
    request<{ skills: SkillCatalogEntry[] }>(`/projects/${projectId}/skills`),
  listGlobalSkills: () =>
    request<{ skills: SkillCatalogEntry[] }>('/skills'),
  listRecommendedSkills: () =>
    request<{ skills: RecommendedSkill[] }>('/skills/recommended'),
  getSkill: (projectId: string, name: string) =>
    request<SkillDetail>(`/projects/${projectId}/skills/${encodeURIComponent(name)}`),
  getGlobalSkill: (name: string) =>
    request<SkillDetail>(`/skills/${encodeURIComponent(name)}`),
  getSkillReferences: (projectId: string, name: string) =>
    request<{ references: SkillReference[] }>(`/projects/${projectId}/skills/${encodeURIComponent(name)}/references`),
  installSkill: (projectId: string, input: InstallSkillInput) =>
    request<InstallSkillResult>(`/projects/${projectId}/skills`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  installGlobalSkill: (input: InstallSkillInput) =>
    request<InstallSkillResult>('/skills', {
      method: 'POST',
      body: JSON.stringify({ ...input, scope: 'global' }),
    }),
  updateSkill: (projectId: string, name: string, input: UpdateSkillInput) =>
    request<Record<string, unknown>>(`/projects/${projectId}/skills/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  updateGlobalSkill: (name: string, input: UpdateSkillInput) =>
    request<Record<string, unknown>>(`/skills/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  syncSkill: (projectId: string, name: string) =>
    request<SyncSkillResult>(`/projects/${projectId}/skills/${encodeURIComponent(name)}/sync`, {
      method: 'POST',
    }),
  syncGlobalSkill: (name: string) =>
    request<SyncSkillResult>(`/skills/${encodeURIComponent(name)}/sync`, {
      method: 'POST',
    }),
  uninstallSkill: (projectId: string, name: string) =>
    request<{ deleted: boolean }>(`/projects/${projectId}/skills/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  uninstallGlobalSkill: (name: string) =>
    request<{ deleted: boolean }>(`/skills/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  listMcpServers: () => request<McpServer[]>('/mcp-servers'),
  createMcpServer: (input: CreateMcpServerInput) =>
    request<McpServer>('/mcp-servers', { method: 'POST', body: JSON.stringify(input) }),
  updateMcpServer: (id: string, input: UpdateMcpServerInput) =>
    request<McpServer>(`/mcp-servers/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteMcpServer: (id: string) =>
    request<{ deleted: boolean }>(`/mcp-servers/${id}`, { method: 'DELETE' }),
  startMcpOauth: (id: string, redirectUri?: string) =>
    request<{ authorizationUrl: string }>(`/mcp-servers/${id}/oauth/start`, {
      method: 'POST',
      body: JSON.stringify({ redirectUri }),
    }),
  getSettings: () => request<AppSettings>('/settings'),
  updateSettings: (input: { branding?: Partial<AppBranding>; preferences?: Partial<AppPreferences> }) =>
    request<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(input) }),
};

export interface BoardConnectionResponse {
  connected?: boolean;
  provider?: string;
  teamId?: string;
  config?: Record<string, string>;
  enabled?: boolean;
  stateMap?: Record<string, string>;
  direction?: BoardSyncDirection;
  autoPush?: boolean;
  importNew?: boolean;
  updateExisting?: boolean;
  syncIntervalMs?: number;
  hasApiKey?: boolean;
  lastSyncedAt?: string;
  id?: string;
  projectId?: string;
  apiKey?: string;
}

export type BoardSyncDirection = 'pull' | 'push' | 'both';

export interface BoardConnectionInput {
  provider?: string;
  apiKey?: string;
  teamId?: string;
  config?: Record<string, string>;
  stateMap?: Record<string, string>;
  direction?: BoardSyncDirection;
  autoPush?: boolean;
  importNew?: boolean;
  updateExisting?: boolean;
  syncIntervalMs?: number | null;
  enabled?: boolean;
}

export interface RunListItem extends WorkflowRun {
  ticketTitle?: string;
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

export interface SyncSummary {
  imported: number;
  updated: number;
}

export interface RemoteContainer {
  id: string;
  name: string;
  key?: string;
}

export interface RemoteState {
  id: string;
  name: string;
  type?: string;
}

/** @deprecated use {@link RemoteContainer}. */
export type LinearTeam = RemoteContainer;
/** @deprecated use {@link RemoteState}. */
export type LinearState = RemoteState;

export function runStreamUrl(runId: string): string {
  return `${getApiBaseUrl()}/runs/${runId}/stream`;
}

export function chatStreamUrl(conversationId: string): string {
  return `${getApiBaseUrl()}/conversations/${conversationId}/stream`;
}

export function boardStreamUrl(projectId: string): string {
  return `${getApiBaseUrl()}/projects/${projectId}/board/stream`;
}
