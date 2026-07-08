import { randomUUID } from 'node:crypto';
import { listWorkflowTemplates, loadProjectConfig } from '@orion/config';
import type {
  ChatEvent,
  ChatMessage,
  ChatUsage,
  Conversation,
  ConversationDetail,
  ProjectConfig,
  Project,
  RouteIntent,
  WorkflowRouteResult,
} from '@orion/models';
import type { AgentProvider, HarnessUsage } from '@orion/harness-core';
import type { Container } from '../container.js';
import { WorkspaceService } from './workspace.service.js';

/** The default chat agent properties used when a project configures none. */
const DEFAULT_CHAT_PROVIDER = 'codex';
const DEFAULT_CHAT_MODEL = 'gpt-5-codex';

const SYSTEM_PREFACE =
  'You are Orion, a helpful coding assistant embedded in a repository. Answer the user directly and concisely. When you inspect or change code, explain what you did.';

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

    let provider = DEFAULT_CHAT_PROVIDER;
    let model = DEFAULT_CHAT_MODEL;
    let baseUrl: string | undefined;
    let agentConfig: Record<string, unknown> | undefined;
    let workingDirectory: string | undefined;
    try {
      const project = await this.c.projects.get(conversation.projectId);
      if (!project) throw new Error(`Project ${conversation.projectId} not found`);
      const configRoot = await this.workspaces.resolveConfigRoot(project);
      workingDirectory = configRoot;
      const config = await loadProjectConfig(configRoot, project.configPath).catch(() => null);
      if (config) {
        const firstAgent = config.workflow.nodes.find((n) => n.type === 'agent');
        if (firstAgent) {
          provider = firstAgent.provider ?? DEFAULT_CHAT_PROVIDER;
          model = firstAgent.model ?? DEFAULT_CHAT_MODEL;
          baseUrl = firstAgent.baseUrl;
          agentConfig = firstAgent.config;
        }
      }
    } catch (err) {
      await this.failTurn(conversationId, err instanceof Error ? err.message : String(err));
      return;
    }

    const apiKey = this.c.env.codexApiKey;
    const effectiveBaseUrl = baseUrl ?? this.c.env.codexBaseUrl;
    if (!apiKey && !effectiveBaseUrl) {
      await this.failTurn(
        conversationId,
        'No API key is configured for the chat agent. Set CODEX_API_KEY (or a provider base URL) to enable chat.',
      );
      return;
    }

    let harness: AgentProvider;
    try {
      harness = this.c.harnesses.get(provider);
    } catch (err) {
      await this.failTurn(conversationId, err instanceof Error ? err.message : String(err));
      return;
    }

    const messages = await this.c.chat.listMessages(conversationId);
    const prompt = buildPrompt(messages);

    let finalResponse = '';
    let usage: HarnessUsage | undefined;
    try {
      const stream = harness.runStreamed(prompt, {
        workingDirectory: workingDirectory ?? process.cwd(),
        model,
        baseUrl: effectiveBaseUrl,
        apiKey,
        config: agentConfig,
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
    this.publish(conversationId, { type: 'error', error });
    const message = await this.c.chat
      .addMessage({ conversationId, role: 'assistant', content: `⚠️ ${error}` })
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

    let project: Project | null = null;
    let config: ProjectConfig | null = null;
    let workingDirectory: string | undefined;
    try {
      project = await this.c.projects.get(projectId);
      if (project) {
        const configRoot = await this.workspaces.resolveConfigRoot(project);
        workingDirectory = configRoot;
        config = await loadProjectConfig(configRoot, project.configPath).catch(() => null);
      }
    } catch {
      // Tolerated: routing must still work without a resolvable checkout.
    }
    const projectWorkflow = config?.workflow.name;
    if (projectWorkflow && !catalog.has(projectWorkflow)) {
      catalog.set(projectWorkflow, projectWorkflow);
    }

    const agent = config?.workflow.nodes.find((n) => n.type === 'agent');
    const provider = agent?.provider ?? DEFAULT_CHAT_PROVIDER;
    const model = agent?.model ?? DEFAULT_CHAT_MODEL;
    const baseUrl = agent?.baseUrl ?? this.c.env.codexBaseUrl;
    const nodeConfig = agent?.config;
    const apiKey = this.c.env.codexApiKey;

    if (apiKey || baseUrl) {
      try {
        const harness = this.c.harnesses.get(provider);
        const result = await harness.run(buildRoutingPrompt(message, templates, projectWorkflow), {
          workingDirectory: workingDirectory ?? process.cwd(),
          model,
          baseUrl,
          apiKey,
          config: nodeConfig,
        });
        const parsed = parseRouteJson(result.finalResponse);
        if (parsed) return this.normalizeRoute(parsed, message, catalog);
      } catch {
        // Fall through to the deterministic heuristic.
      }
    }

    return fallbackRoute(message, projectWorkflow, catalog);
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
        : 'No workflow clearly matches this request, so continue in chat.',
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
