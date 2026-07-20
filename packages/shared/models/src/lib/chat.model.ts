import type { ProjectId } from './project.model.js';
import type { RunNodeUsage } from './run.model.js';

export type ConversationId = string;
export type ChatMessageId = string;

/** Who authored a chat message. */
export type ChatRole = 'user' | 'assistant' | 'system';

/** Token/cost usage recorded for an assistant turn (reuses the run shape). */
export type ChatUsage = RunNodeUsage;

/** A direct-chat conversation with the configured coding agent for a project. */
export interface Conversation {
  id: ConversationId;
  projectId: ProjectId;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: ChatMessageId;
  conversationId: ConversationId;
  role: ChatRole;
  content: string;
  /** Token/cost usage for an assistant turn, when the harness reports it. */
  usage?: ChatUsage;
  createdAt: string;
}

/** A conversation with its ordered messages. */
export interface ConversationDetail {
  conversation: Conversation;
  messages: ChatMessage[];
}

/**
 * Whether a natural-language request should kick off a workflow `run` or is
 * better handled as an interactive `chat`.
 */
export type RouteIntent = 'run' | 'chat';

/** Result of routing a natural-language request to a workflow (or to chat). */
export interface WorkflowRouteResult {
  intent: RouteIntent;
  /** Recommended workflow name (validated against the catalog) when `run`. */
  workflowName?: string;
  /** Human title of the recommended workflow, when known. */
  workflowTitle?: string;
  /** Suggested ticket title derived from the request, when `run`. */
  ticketTitle?: string;
  /** Short human-readable explanation of the recommendation. */
  reasoning: string;
}

/**
 * Server-Sent Event streamed while an assistant turn runs (mirrors run events).
 * `message` carries a fully persisted message (replay + echo + final);
 * `message.delta` carries streaming assistant text; `item` carries tool/agent
 * activity; `usage` and `done`/`error` bracket the turn.
 */
export interface ChatEvent {
  id: string;
  type: 'message.delta' | 'message' | 'item' | 'usage' | 'done' | 'error';
  conversationId: ConversationId;
  /** Persisted message for `message` events (user echo, final assistant). */
  message?: ChatMessage;
  /** Streaming assistant text for `message.delta` events. */
  text?: string;
  /** Tool/agent activity payload for `item` events. */
  item?: unknown;
  /** Token/cost usage for `usage`/`done` events. */
  usage?: ChatUsage;
  /** Error text for `error` events. */
  error?: string;
  createdAt: string;
}

export interface CreateConversationInput {
  projectId: ProjectId;
  title?: string;
}

export interface AddChatMessageInput {
  conversationId: ConversationId;
  role: ChatRole;
  content: string;
  usage?: ChatUsage;
}

export interface AgentTicketPreviewRequest {
  prompt: string;
}

export interface AgentTicketPreviewResponse {
  title: string;
  description: string;
  type: string;
  priority: number;
  labels: string[];
  reasoning: string;
}

export interface AgentTicketUpdateRequest {
  prompt: string;
}

export interface AgentTicketUpdateResponse {
  title?: string;
  description?: string;
  type?: string;
  priority?: number;
  labelIds?: string[];
  reasoning: string;
}
