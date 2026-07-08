import type {
  ApiResponse,
  Board,
  BoardConfig,
  ChatMessage,
  CodeIndex,
  Conversation,
  ConversationDetail,
  CreateEvaluationInput,
  CreateProjectInput,
  CreateProviderInput,
  CreateTicketInput,
  CreateTriggerInput,
  EvaluationSummary,
  InstallSkillInput,
  InstallSkillResult,
  Label,
  Project,
  Provider,
  RunEvaluation,
  RunEvent,
  RunNode,
  SearchResult,
  SkillCatalogEntry,
  SkillDetail,
  SkillReference,
  SyncSkillResult,
  Ticket,
  TicketDetail,
  TicketRelation,
  TicketRelationKind,
  Trigger,
  UpdateEvaluationInput,
  UpdateProjectInput,
  UpdateProviderInput,
  UpdateSkillInput,
  UpdateTicketInput,
  UpdateTriggerInput,
  WorkflowConfig,
  WorkflowRouteResult,
  WorkflowRun,
  WorkflowTemplateSummary,
} from '@orion/models';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api';

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
  const response = await fetch(`${API_URL}${path}`, {
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
  moveTicket: (ticketId: string, swimlane: string, order?: number) =>
    request<Ticket>(`/tickets/${ticketId}/move`, {
      method: 'POST',
      body: JSON.stringify({ swimlane, order }),
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
  listTriggers: (projectId: string) => request<Trigger[]>(`/projects/${projectId}/triggers`),
  createTrigger: (projectId: string, input: Omit<CreateTriggerInput, 'projectId'>) =>
    request<Trigger>(`/projects/${projectId}/triggers`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTrigger: (id: string, input: UpdateTriggerInput) =>
    request<Trigger>(`/triggers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteTrigger: (id: string) =>
    request<{ deleted: boolean }>(`/triggers/${id}`, { method: 'DELETE' }),
  fireTrigger: (id: string) =>
    request<WorkflowRun>(`/triggers/${id}/fire`, { method: 'POST', body: JSON.stringify({}) }),
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
  listLinearTeams: (projectId: string, apiKey: string) =>
    request<LinearTeam[]>(`/projects/${projectId}/board-connection/teams?apiKey=${encodeURIComponent(apiKey)}`),
    listLinearStates: (projectId: string, apiKey: string, teamId: string) =>
    request<LinearState[]>(
      `/projects/${projectId}/board-connection/states?apiKey=${encodeURIComponent(apiKey)}&teamId=${encodeURIComponent(teamId)}`,
    ),
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
};

export interface BoardConnectionResponse {
  connected?: boolean;
  provider?: string;
  teamId?: string;
  enabled?: boolean;
  stateMap?: Record<string, string>;
  lastSyncedAt?: string;
  id?: string;
  projectId?: string;
  apiKey?: string;
}

export interface BoardConnectionInput {
  apiKey?: string;
  teamId?: string;
  stateMap?: Record<string, string>;
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

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearState {
  id: string;
  name: string;
  type: string;
}

export function runStreamUrl(runId: string): string {
  return `${API_URL}/runs/${runId}/stream`;
}

export function chatStreamUrl(conversationId: string): string {
  return `${API_URL}/conversations/${conversationId}/stream`;
}

export function boardStreamUrl(projectId: string): string {
  return `${API_URL}/projects/${projectId}/board/stream`;
}

/** Public endpoint a webhook trigger fires on: `<orchestrator>/api/webhooks/triggers/<token>`. */
export function triggerWebhookUrl(token: string): string {
  return `${API_URL}/webhooks/triggers/${token}`;
}
