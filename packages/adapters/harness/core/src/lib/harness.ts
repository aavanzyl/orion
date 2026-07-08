import type { Keyed } from '@orion/adapter-kit';
import { ProviderRegistry } from '@orion/adapter-kit';

/** A single Model Context Protocol server made available to the harness. */
export interface HarnessMcpServer {
  /** Executable to launch for a stdio MCP server. */
  command?: string;
  /** Arguments passed to `command`. */
  args?: string[];
  /** Environment variables provided to the server process. */
  env?: Record<string, string>;
  /** URL of a streamable HTTP MCP server (alternative to `command`). */
  url?: string;
  /** Bearer token used to authenticate against an HTTP MCP server. */
  bearerToken?: string;
}

/** Options passed to a harness for a single turn of work. */
export interface HarnessRunOptions {
  /** Directory the agent operates in (an isolated git worktree). */
  workingDirectory: string;
  /** Model identifier, e.g. `gpt-5-codex`. */
  model?: string;
  /** OpenAI-compatible base URL for third-party providers (e.g. DeepSeek). */
  baseUrl?: string;
  /** API key for the underlying provider. */
  apiKey?: string;
  /** Existing thread id to resume a prior conversation. */
  threadId?: string;
  /** MCP servers to expose to the agent, keyed by unique server name. */
  mcpServers?: Record<string, HarnessMcpServer>;
  /** Additional provider-specific configuration overrides. */
  config?: Record<string, unknown>;
  /** Abort signal used to cancel an in-flight turn. */
  signal?: AbortSignal;
}

/** Token/cost usage reported by a harness for a single turn (best-effort). */
export interface HarnessUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  costUsd?: number;
}

export interface HarnessTurnResult {
  finalResponse: string;
  /** Thread id enabling later resume; persisted on the run. */
  threadId?: string;
  items?: unknown[];
  /** Token/cost usage for the turn, when the provider reports it. */
  usage?: HarnessUsage;
}

/** Normalized streaming events emitted by every harness. */
export type HarnessEvent =
  | { type: 'message'; text: string }
  | { type: 'item'; item: unknown }
  | { type: 'completed'; result: HarnessTurnResult };

/**
 * A coding-agent execution harness (Codex today; Claude, opencode later).
 * The harness owns reasoning only; orchestration lives in the workflow engine.
 */
export interface AgentProvider extends Keyed {
  run(prompt: string, options: HarnessRunOptions): Promise<HarnessTurnResult>;
  runStreamed(prompt: string, options: HarnessRunOptions): AsyncIterable<HarnessEvent>;
}

export class HarnessRegistry extends ProviderRegistry<AgentProvider> {
  constructor() {
    super('harness');
  }
}
