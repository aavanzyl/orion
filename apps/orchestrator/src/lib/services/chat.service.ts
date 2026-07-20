import { randomUUID } from 'node:crypto';
import { listWorkflowTemplates, loadProjectConfig } from '@orion/config';
import type {
  AgentDefaults,
  AgentTicketPreviewResponse,
  AgentTicketUpdateResponse,
  ChatEvent,
  ChatMessage,
  ChatUsage,
  Conversation,
  ConversationDetail,
  McpServerMap,
  RouteIntent,
  WorkflowRouteResult,
} from '@orion/models';
import type { AgentProvider, HarnessUsage } from '@orion/harness-core';
import type { Container } from '../container.js';
import { decrypt } from '../crypto.js';
import { WorkspaceService } from './workspace.service.js';

/** The default chat agent properties used when a project configures none. */
const DEFAULT_CHAT_PROVIDER = 'codex';
const DEFAULT_CHAT_MODEL = 'gpt-5-codex';

const SYSTEM_PREFACE =
  'You are Orion, a helpful coding assistant embedded in a repository. Always speak in facts — be direct, precise, and evidence-based. Never speculate without clear basis. When you inspect or change code, explain exactly what you did and why. Keep answers concise.';

/**
 * Drives the direct-chat experience: persists conversations/messages, streams an
 * assistant turn through the configured harness (publishing {@link ChatEvent}s on
 * the {@link ChatEventBus}), and routes natural-language requests to workflows.
 */
export class ChatService {
  private readonly workspaces: WorkspaceService;

  constructor(private readonly c: Container) {
    this.workspaces = new WorkspaceService(c);
  }

  createConversation(projectId: string, title?: string): Promise<Conversation> {
    return this.c.chat.createConversation({ projectId, title });
  }

  listConversations(projectId: string): Promise<Conversation[]> {
    return this.c.chat.listConversations(projectId);
  }

  deleteConversation(id: string): Promise<boolean> {
    return this.c.chat.deleteConversation(id);
  }

  async getConversation(id: string): Promise<ConversationDetail | null> {
    const conversation = await this.c.chat.getConversation(id);
    if (!conversation) return null;
    const messages = await this.c.chat.listMessages(id);
    return { conversation, messages };
  }

  /**
   * Persist the user's message, then kick off the assistant turn asynchronously
   * so the SSE stream (not the POST) carries the response. Returns the persisted
   * user message.
   */
  async sendMessage(conversationId: string, content: string): Promise<ChatMessage> {
    const conversation = await this.c.chat.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation ${conversationId} not found`);

    const userMessage = await this.c.chat.addMessage({
      conversationId,
      role: 'user',
      content,
    });
    await this.c.chat.touch(conversationId);
    this.publishMessage(conversationId, userMessage);

    // Give a fresh conversation a meaningful title from its first user message.
    if (conversation.title === 'New conversation') {
      await this.c.chat
        .updateConversationTitle(conversationId, deriveTitle(content))
        .catch(() => undefined);
    }

    void this.runTurn(conversationId).catch((err: unknown) => {
      console.error(`[ orion orchestrator ] chat turn ${conversationId} failed:`, err);
    });

    return userMessage;
  }

  /** Run a single assistant turn over the full conversation history. */
  private async runTurn(conversationId: string): Promise<void> {
    const conversation = await this.c.chat.getConversation(conversationId);
    if (!conversation) return;

    let agent: ResolvedChatAgent;
    try {
      agent = await this.resolveChatAgent(conversation.projectId);
    } catch (err) {
      await this.failTurn(conversationId, err instanceof Error ? err.message : String(err));
      return;
    }

    if (!agent.apiKey && !agent.baseUrl) {
      await this.failTurn(
        conversationId,
        'No API key is configured for the chat agent. Choose a provider with an API key in Settings, or set CODEX_API_KEY (or a provider base URL).',
      );
      return;
    }

    let harness: AgentProvider;
    try {
      harness = this.c.harnesses.get(agent.harness);
    } catch (err) {
      await this.failTurn(conversationId, err instanceof Error ? err.message : String(err));
      return;
    }

    const messages = await this.c.chat.listMessages(conversationId);
    const prompt = buildPrompt(messages);
    const mcpServers = this.builtinMcpServers(conversation.projectId);

    let finalResponse = '';
    let usage: HarnessUsage | undefined;
    try {
      const stream = harness.runStreamed(prompt, {
        workingDirectory: agent.workingDirectory ?? process.cwd(),
        model: agent.model,
        baseUrl: agent.baseUrl,
        apiKey: agent.apiKey,
        mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
        config: agent.config,
      });

      for await (const event of stream) {
        if (event.type === 'message') {
          finalResponse = event.text;
          this.publish(conversationId, { type: 'message.delta', text: event.text });
        } else if (event.type === 'item') {
          this.publish(conversationId, { type: 'item', item: event.item });
        } else if (event.type === 'completed') {
          finalResponse = event.result.finalResponse || finalResponse;
          usage = event.result.usage;
        }
      }
    } catch (err) {
      await this.failTurn(conversationId, err instanceof Error ? err.message : String(err));
      return;
    }

    const chatUsage = toChatUsage(usage);
    if (chatUsage) this.publish(conversationId, { type: 'usage', usage: chatUsage });

    const assistantMessage = await this.c.chat.addMessage({
      conversationId,
      role: 'assistant',
      content: finalResponse || '(no response)',
      usage: chatUsage,
    });
    await this.c.chat.touch(conversationId);
    this.publishMessage(conversationId, assistantMessage);
    this.publish(conversationId, { type: 'done', usage: chatUsage });
  }

  /** Persist a short error assistant message and publish an error + done event. */
  private async failTurn(conversationId: string, error: string): Promise<void> {
    const displayError = normalizeChatError(error);
    this.publish(conversationId, { type: 'error', error: displayError });
    const message = await this.c.chat
      .addMessage({ conversationId, role: 'assistant', content: `⚠️ ${displayError}` })
      .catch(() => null);
    if (message) this.publishMessage(conversationId, message);
    this.publish(conversationId, { type: 'done' });
  }

  /**
   * Route a natural-language request to a workflow (or to chat). Attempts a
   * single non-streamed harness turn asking for strict JSON; on any failure
   * falls back to a deterministic keyword heuristic. Never throws.
   */
  async route(projectId: string, message: string): Promise<WorkflowRouteResult> {
    const templates = listWorkflowTemplates();
    const catalog = new Map(templates.map((t) => [t.name, t.title]));

    let agent: ResolvedChatAgent | null = null;
    let projectWorkflow: string | undefined;
    try {
      agent = await this.resolveChatAgent(projectId);
      projectWorkflow = agent.workflowName;
    } catch {
      // Tolerated: routing must still work without a resolvable checkout.
    }
    if (projectWorkflow && !catalog.has(projectWorkflow)) {
      catalog.set(projectWorkflow, projectWorkflow);
    }

    if (agent && (agent.apiKey || agent.baseUrl)) {
      try {
        const harness = this.c.harnesses.get(agent.harness);
        const result = await harness.run(buildRoutingPrompt(message, templates, projectWorkflow), {
          workingDirectory: agent.workingDirectory ?? process.cwd(),
          model: agent.model,
          baseUrl: agent.baseUrl,
          apiKey: agent.apiKey,
          config: agent.config,
        });
        const parsed = parseRouteJson(result.finalResponse);
        if (parsed) return this.normalizeRoute(parsed, message, catalog);
      } catch {
        // Fall through to the deterministic heuristic.
      }
    }

    return fallbackRoute(message, projectWorkflow, catalog);
  }

  /**
   * Generate a ticket draft from a natural-language prompt. The agent fills in
   * title, description, type, priority and suggested labels — the caller can
   * then present the draft for user review before persisting.
   */
  async previewTicket(projectId: string, prompt: string): Promise<AgentTicketPreviewResponse> {
    const agent = await this.resolveChatAgent(projectId);
    const board = this.c.boards.get('native');
    const [labels, allTickets] = await Promise.all([
      board.listLabels(projectId),
      this.c.tickets.listByProject(projectId),
    ]);
    const labelsCsv = labels.map((l) => l.name).join(', ');
    const existingTitles = allTickets.map((t) => t.title).join('\n- ');
    const harness = this.c.harnesses.get(agent.harness);
    const result = await harness.run(
      buildTicketPreviewPrompt(prompt, labelsCsv, existingTitles),
      {
        workingDirectory: agent.workingDirectory ?? process.cwd(),
        model: agent.model,
        baseUrl: agent.baseUrl,
        apiKey: agent.apiKey,
        config: agent.config,
      },
    );
    return parseTicketPreviewJson(result.finalResponse, prompt);
  }

  /**
   * Generate update suggestions for an existing ticket from a natural-language
   * instruction. Returns only the fields that the agent believes should change.
   */
  async previewTicketUpdate(ticketId: string, prompt: string): Promise<AgentTicketUpdateResponse> {
    const board = this.c.boards.get('native');
    const detail = await board.getTicketDetail(ticketId);
    if (!detail) throw new Error(`Ticket ${ticketId} not found`);
    const agent = await this.resolveChatAgent(detail.projectId);
    const labels = await board.listLabels(detail.projectId);
    const harness = this.c.harnesses.get(agent.harness);
    const result = await harness.run(
      buildTicketUpdatePrompt(detail, labels.map((l) => ({ id: l.id, name: l.name })), prompt),
      {
        workingDirectory: agent.workingDirectory ?? process.cwd(),
        model: agent.model,
        baseUrl: agent.baseUrl,
        apiKey: agent.apiKey,
        config: agent.config,
      },
    );
    return parseTicketUpdateJson(result.finalResponse, prompt);
  }

  /**
   * Resolve the effective chat agent (harness, model, base URL, API key) for a
   * project. The user's saved {@link AgentDefaults} in Settings take precedence
   * (that is the agent they explicitly chose for chat); the project's first
   * workflow agent node is the fallback, then environment defaults. When
   * Settings names a provider, that provider's harness, base URL, and stored
   * (decrypted) API key are used as a coherent unit so the model always matches
   * the endpoint it is sent to.
   */
  private async resolveChatAgent(projectId: string): Promise<ResolvedChatAgent> {
    let harness: string | undefined;
    let model: string | undefined;
    let baseUrl: string | undefined;
    let apiKey: string | undefined;
    let config: Record<string, unknown> | undefined;
    let workflowName: string | undefined;

    const project = await this.c.projects.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    const configRoot = await this.workspaces.resolveConfigRoot(project);
    const workingDirectory = configRoot;
    const projectConfig = await loadProjectConfig(configRoot, project.configPath).catch(() => null);
    if (projectConfig) {
      workflowName = projectConfig.workflow.name;
      const firstAgent = projectConfig.workflow.nodes.find((n) => n.type === 'agent');
      if (firstAgent) {
        harness = firstAgent.provider ?? harness;
        model = firstAgent.model ?? model;
        baseUrl = firstAgent.baseUrl ?? baseUrl;
        config = firstAgent.config ?? config;
      }
    }

    // The Settings selection is authoritative for chat and overrides project
    // config. A chosen provider supplies a coherent harness/baseUrl/apiKey set,
    // so the model is never mismatched with the endpoint it is sent to.
    const defaults = await this.loadAgentDefaults();
    if (defaults.providerId) {
      const configured = await this.c.providers.get(defaults.providerId).catch(() => null);
      if (configured) {
        harness = configured.harness ?? harness;
        baseUrl = configured.baseUrl ?? baseUrl;
        // Default to the provider's first model so the request targets a model
        // the endpoint actually serves (e.g. `deepseek-chat`), never a codex
        // default. An explicit Settings model below still takes precedence.
        model = configured.models[0] ?? undefined;
        const stored = await this.c.providers.getApiKey(configured.id).catch(() => null);
        if (stored) {
          apiKey = this.c.env.providerEncryptionSalt
            ? decrypt(stored, this.c.env.providerEncryptionSalt)
            : stored;
        }
      }
    }
    if (defaults.harness) harness = defaults.harness;
    if (defaults.model) model = defaults.model;

    const effectiveBaseUrl = baseUrl ?? this.c.env.codexBaseUrl;
    return {
      harness: this.selectHarness(harness ?? DEFAULT_CHAT_PROVIDER, effectiveBaseUrl),
      model: model ?? DEFAULT_CHAT_MODEL,
      baseUrl: effectiveBaseUrl,
      apiKey: apiKey ?? this.c.env.codexApiKey,
      config,
      workingDirectory,
      workflowName,
    };
  }

  /**
   * Choose the harness that can actually service the request. The Codex harness
   * speaks only OpenAI's Responses API, so a non-OpenAI (e.g. DeepSeek) endpoint
   * configured against `codex` is redirected to the `claude` harness, which
   * drives Anthropic-compatible providers. Any explicitly chosen harness is left
   * untouched.
   */
  private selectHarness(harness: string, baseUrl: string | undefined): string {
    if (harness === 'codex' && baseUrl && !isOpenAiBaseUrl(baseUrl) && this.c.harnesses.has('claude')) {
      return 'claude';
    }
    return harness;
  }

  private async loadAgentDefaults(): Promise<AgentDefaults> {
    try {
      const settings = await this.c.settings.get();
      return settings.preferences?.agentDefaults ?? {};
    } catch {
      return {};
    }
  }

  /** Validate a model-produced route against the catalog + project workflow. */
  private normalizeRoute(
    parsed: ParsedRoute,
    message: string,
    catalog: Map<string, string>,
  ): WorkflowRouteResult {
    const intent: RouteIntent = parsed.intent === 'run' ? 'run' : 'chat';
    const reasoning = parsed.reasoning?.trim() || 'Recommended based on your request.';
    if (intent === 'chat') {
      return { intent: 'chat', reasoning };
    }
    const workflowName =
      parsed.workflowName && catalog.has(parsed.workflowName) ? parsed.workflowName : undefined;
    if (!workflowName) {
      return { intent: 'chat', reasoning: reasoning || 'No matching workflow found.' };
    }
    return {
      intent: 'run',
      workflowName,
      workflowTitle: catalog.get(workflowName),
      ticketTitle: parsed.ticketTitle?.trim() || deriveTitle(message),
      reasoning,
    };
  }

  /**
   * The built-in Orion MCP servers (codebase + tickets) bound and locked to the
   * chat's project so the agent can search the repo and read/write tickets for
   * that project only (`lock=1` forbids cross-project access). Only takes effect
   * on a harness that supports MCP (e.g. Codex, Claude); the OpenAI
   * chat-completions harness ignores `mcpServers`.
   */
  private builtinMcpServers(projectId: string): McpServerMap {
    return {
      'orion-codebase': {
        url: `${this.c.env.publicUrl}/mcp/codebase?projectId=${projectId}&lock=1`,
      },
      'orion-tickets': {
        url: `${this.c.env.publicUrl}/mcp/tickets?projectId=${projectId}&lock=1`,
      },
      'orion-skills': {
        url: `${this.c.env.publicUrl}/mcp/skills?projectId=${projectId}&lock=1`,
      },
    };
  }

  private publishMessage(conversationId: string, message: ChatMessage): void {
    this.c.chatBus.publish({
      id: message.id,
      type: 'message',
      conversationId,
      message,
      createdAt: new Date().toISOString(),
    });
  }

  private publish(conversationId: string, partial: Omit<ChatEvent, 'id' | 'conversationId' | 'createdAt'>): void {
    this.c.chatBus.publish({
      id: randomUUID(),
      conversationId,
      createdAt: new Date().toISOString(),
      ...partial,
    });
  }
}

interface ParsedRoute {
  intent?: string;
  workflowName?: string | null;
  ticketTitle?: string | null;
  reasoning?: string;
}

/** The concrete chat agent settings resolved from project config + Settings. */
interface ResolvedChatAgent {
  harness: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  config?: Record<string, unknown>;
  workingDirectory?: string;
  workflowName?: string;
}

/** Concatenate the conversation history into a single prompt string. */
function buildPrompt(messages: ChatMessage[]): string {
  const lines = [SYSTEM_PREFACE, ''];
  for (const message of messages) {
    if (message.role === 'system') continue;
    const speaker = message.role === 'assistant' ? 'Assistant' : 'User';
    lines.push(`${speaker}: ${message.content}`);
  }
  lines.push('', 'Assistant:');
  return lines.join('\n');
}

/** Build the strict-JSON routing prompt from the workflow catalog. */
function buildRoutingPrompt(
  message: string,
  templates: ReturnType<typeof listWorkflowTemplates>,
  projectWorkflow: string | undefined,
): string {
  const catalog = templates
    .map((t) => `- ${t.name}: ${t.title} — ${t.description}`)
    .join('\n');
  return [
    'You are a router that decides whether a user request should start an automated coding workflow ("run") or is better answered conversationally ("chat").',
    '',
    'Available workflows:',
    catalog,
    projectWorkflow ? `\nThe project's default configured workflow is "${projectWorkflow}".` : '',
    '',
    `User request: ${message}`,
    '',
    'Reply with STRICT JSON only, no prose, matching exactly:',
    '{ "intent": "run" | "chat", "workflowName": string | null, "ticketTitle": string | null, "reasoning": string }',
    'If intent is "run", workflowName MUST be one of the workflow names above and ticketTitle should be a concise ticket title. If the request is a question or discussion, use intent "chat" with workflowName null.',
  ].join('\n');
}

/** Extract and parse the first `{...}` JSON block from a model response. */
function parseRouteJson(text: string): ParsedRoute | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as ParsedRoute;
  } catch {
    return null;
  }
}

/**
 * Deterministic router fallback used when no harness key is available or the
 * model response cannot be parsed. Questions map to `chat`; imperative requests
 * map to `run` with a sensible catalog workflow.
 */
function fallbackRoute(
  message: string,
  projectWorkflow: string | undefined,
  catalog: Map<string, string>,
): WorkflowRouteResult {
  const text = message.trim().toLowerCase();
  const isQuestion =
    text.endsWith('?') || /^(who|what|why|how|when|where|which|can|does|is|are|should)\b/.test(text);

  const pick = (name: string): string | undefined =>
    catalog.has(name) ? name : projectWorkflow && catalog.has(projectWorkflow) ? projectWorkflow : undefined;

  let workflowName: string | undefined;
  let reasoning = '';
  if (/\b(bug|fix|broken|crash|error|regression)\b/.test(text)) {
    workflowName = pick('fix-bug');
    reasoning = 'The request describes fixing a bug.';
  } else if (/\b(review|audit|inspect)\b/.test(text)) {
    workflowName = pick('multi-agent-review');
    reasoning = 'The request asks for a review.';
  } else if (/\b(refactor|clean\s?up|reorganize)\b/.test(text)) {
    workflowName = pick('refactor-safely');
    reasoning = 'The request is a refactor.';
  } else if (/\b(test|tests|tdd)\b/.test(text)) {
    workflowName = pick('tdd');
    reasoning = 'The request centers on tests.';
  } else if (/\b(doc|docs|documentation|readme)\b/.test(text)) {
    workflowName = pick('docs-update');
    reasoning = 'The request is about documentation.';
  } else if (/\b(implement|add|create|build|feature|support|introduce)\b/.test(text)) {
    workflowName = pick(projectWorkflow ?? 'feature-development') ?? pick('feature-development');
    reasoning = 'The request describes building a feature.';
  }

  if (isQuestion || !workflowName) {
    return {
      intent: 'chat',
      reasoning: isQuestion
        ? 'The request looks like a question, so it is better answered in chat.'
        : 'No matching workflow found. Let me help you in chat instead.',
    };
  }

  return {
    intent: 'run',
    workflowName,
    workflowTitle: catalog.get(workflowName),
    ticketTitle: deriveTitle(message),
    reasoning,
  };
}

/** True when the base URL is OpenAI's own API (which uses the Responses API). */
function isOpenAiBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === 'api.openai.com' || host.endsWith('.openai.azure.com');
  } catch {
    return false;
  }
}

/** Turn a free-form message into a short, single-line ticket/conversation title. */
function deriveTitle(text: string): string {
  const firstLine = text.trim().split('\n')[0].trim();
  const clean = firstLine.replace(/\s+/g, ' ');
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean || 'New conversation';
}

function toChatUsage(usage: HarnessUsage | undefined): ChatUsage | undefined {
  if (!usage) return undefined;
  const { inputTokens, outputTokens, totalTokens, costUsd } = usage;
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    costUsd === undefined
  ) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens, costUsd };
}

/** Turn raw harness errors into user-friendly messages with recovery hints. */
function normalizeChatError(error: string): string {
  if (/exited with code/i.test(error)) {
    return `${error}. This usually happens when the provider's API is unreachable or the model is not supported. Try again or check your provider configuration in Settings.`;
  }
  if (/API key/i.test(error) || /auth/i.test(error) || /unauthorized/i.test(error)) {
    return `${error}. Check your API key in Settings or set an environment variable for your provider.`;
  }
  if (/timeout|ETIMEDOUT/i.test(error)) {
    return `${error}. The request timed out. Try again or check your network connection.`;
  }
  return error;
}

function buildTicketPreviewPrompt(prompt: string, labelsCsv: string, existingTitles: string): string {
  return [
    'You are an assistant that drafts tickets for a software project board. Given a natural-language request, produce a structured ticket draft.',
    '',
    'Project context:',
    `Available labels: ${labelsCsv || '(none)'}`,
    `Existing ticket titles:\n- ${existingTitles || '(none)'}`,
    '',
    `User request: ${prompt}`,
    '',
    'Reply with STRICT JSON only, no prose, matching exactly:',
    '{ "title": string, "description": string, "type": "feature" | "bug" | "issue" | "hotfix", "priority": 0 | 1 | 2 | 3 | 4, "labels": string[], "reasoning": string }',
    'Priority: 0=no priority, 1=urgent, 2=high, 3=medium, 4=low.',
    'Choose labels from the available list. Do NOT invent new labels.',
    'Write the description in markdown with clear acceptance criteria.',
  ].join('\n');
}

function parseTicketPreviewJson(text: string, fallbackTitle: string): AgentTicketPreviewResponse {
  const json = extractFirstJson(text);
  if (json) {
    const obj = json as Record<string, unknown>;
    return {
      title: typeof obj.title === 'string' && obj.title ? obj.title : fallbackTitle.slice(0, 80),
      description: typeof obj.description === 'string' ? obj.description : '',
      type: typeof obj.type === 'string' ? obj.type : 'feature',
      priority: typeof obj.priority === 'number' && obj.priority >= 0 && obj.priority <= 4 ? obj.priority : 0,
      labels: Array.isArray(obj.labels) ? obj.labels.filter((l: unknown): l is string => typeof l === 'string') : [],
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
    };
  }
  return {
    title: fallbackTitle.slice(0, 80),
    description: '',
    type: 'feature',
    priority: 0,
    labels: [],
    reasoning: '',
  };
}

function buildTicketUpdatePrompt(
  ticket: { title: string; description: string; type: string; priority: number },
  labels: { id: string; name: string }[],
  prompt: string,
): string {
  const labelList = labels.map((l) => `${l.name} (id: ${l.id})`).join(', ');
  return [
    'You are an assistant that updates software project tickets. Given a ticket and a natural-language instruction, return the fields that should change.',
    '',
    `Current ticket:`,
    `Title: ${ticket.title}`,
    `Type: ${ticket.type}`,
    `Priority: ${ticket.priority} (0=none, 1=urgent, 2=high, 3=medium, 4=low)`,
    `Description: ${ticket.description.slice(0, 500)}`,
    `Available labels: ${labelList || '(none)'}`,
    '',
    `Update instruction: ${prompt}`,
    '',
    'Reply with STRICT JSON only, no prose, matching exactly:',
    '{ "title": string | null, "description": string | null, "type": string | null, "priority": number | null, "labelIds": string[] | null, "reasoning": string }',
    'Only include fields that should change. For unchanged fields, use null. Use the exact label ids from the available list.',
  ].join('\n');
}

function parseTicketUpdateJson(text: string, fallbackReason: string): AgentTicketUpdateResponse {
  const json = extractFirstJson(text);
  if (json) {
    const obj = json as Record<string, unknown>;
    return {
      title: typeof obj.title === 'string' && obj.title ? obj.title : undefined,
      description: typeof obj.description === 'string' && obj.description ? obj.description : undefined,
      type: typeof obj.type === 'string' && obj.type ? obj.type : undefined,
      priority: typeof obj.priority === 'number' && obj.priority >= 0 && obj.priority <= 4 ? obj.priority : undefined,
      labelIds: Array.isArray(obj.labelIds) ? obj.labelIds.filter((l: unknown): l is string => typeof l === 'string') : undefined,
      reasoning: typeof obj.reasoning === 'string' && obj.reasoning ? obj.reasoning : fallbackReason,
    };
  }
  return {
    title: undefined,
    description: undefined,
    type: undefined,
    priority: undefined,
    labelIds: undefined,
    reasoning: fallbackReason,
  };
}

function extractFirstJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
