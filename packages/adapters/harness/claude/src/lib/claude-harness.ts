import { query, type McpServerConfig, type Options } from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentProvider,
  HarnessEvent,
  HarnessMcpServer,
  HarnessRunOptions,
  HarnessTurnResult,
  HarnessUsage,
} from '@orion/harness-core';

export interface ClaudeHarnessDefaults {
  /** Fallback API key when a run does not supply one. */
  apiKey?: string;
  /** Fallback base URL for Anthropic-compatible providers (e.g. DeepSeek). */
  baseUrl?: string;
  /** Default model when a run/agent does not specify one. */
  model?: string;
}

/** A single content block on an assistant message (Anthropic `BetaMessage`). */
interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  [key: string]: unknown;
}

/** Best-effort usage extracted from the SDK `result` message. */
function toHarnessUsage(usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
} | null | undefined, costUsd?: number): HarnessUsage | undefined {
  if (!usage && costUsd === undefined) return undefined;
  const inputTokens = usage?.input_tokens;
  const outputTokens = usage?.output_tokens;
  const totalTokens =
    inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: usage?.cache_read_input_tokens ?? undefined,
    costUsd,
  };
}

/** Translate Orion's neutral MCP definitions into the Claude SDK's config shape. */
function toMcpServers(
  servers: Record<string, HarnessMcpServer> | undefined,
): Record<string, McpServerConfig> | undefined {
  if (!servers || Object.keys(servers).length === 0) return undefined;
  const out: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(servers)) {
    if (server.command) {
      out[name] = {
        type: 'stdio',
        command: server.command,
        args: server.args,
        env: server.env,
      };
    } else if (server.url) {
      // Orion's built-in servers (codebase, tickets) are served over SSE.
      out[name] = {
        type: 'sse',
        url: server.url,
        headers: server.bearerToken
          ? { Authorization: `Bearer ${server.bearerToken}` }
          : undefined,
      };
    }
  }
  return out;
}

/**
 * Normalize an Anthropic-compatible base URL. Claude Code appends `/v1/messages`
 * to `ANTHROPIC_BASE_URL`, so a trailing `/v1` (as used by OpenAI-style config)
 * would be doubled — strip it, along with any trailing slashes.
 */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

/**
 * Claude execution harness. Wraps `@anthropic-ai/claude-agent-sdk`, which spawns
 * the bundled Claude Code CLI inside the run's isolated git worktree. Credentials
 * and a custom Anthropic-compatible endpoint are forwarded to the subprocess via
 * environment variables, so this harness also drives third-party models (e.g.
 * DeepSeek's Anthropic-compatible API) that outperform Codex on non-OpenAI stacks.
 */
export class ClaudeHarness implements AgentProvider {
  readonly key = 'claude';

  constructor(private readonly defaults: ClaudeHarnessDefaults = {}) {}

  private buildOptions(options: HarnessRunOptions): Options {
    const apiKey = options.apiKey ?? this.defaults.apiKey;
    const baseUrl = options.baseUrl ?? this.defaults.baseUrl;
    const model = options.model ?? this.defaults.model;

    const env: Record<string, string | undefined> = { ...process.env };
    if (apiKey) {
      // Third-party Anthropic-compatible endpoints (DeepSeek, LiteLLM, OpenRouter)
      // authenticate with a bearer token; the official Anthropic API uses the
      // `x-api-key` header sourced from `ANTHROPIC_API_KEY`.
      if (baseUrl) env.ANTHROPIC_AUTH_TOKEN = apiKey;
      else env.ANTHROPIC_API_KEY = apiKey;
    }
    if (baseUrl) env.ANTHROPIC_BASE_URL = normalizeBaseUrl(baseUrl);
    if (model) {
      env.ANTHROPIC_MODEL = model;
      // Claude Code otherwise reaches for a Claude "small/fast" model for helper
      // tasks (titles, quick edits) that a third-party provider will not serve.
      if (baseUrl) env.ANTHROPIC_SMALL_FAST_MODEL = model;
    }

    let abortController: AbortController | undefined;
    if (options.signal) {
      abortController = new AbortController();
      if (options.signal.aborted) abortController.abort();
      else
        options.signal.addEventListener('abort', () => abortController?.abort(), {
          once: true,
        });
    }

    const built: Options = {
      cwd: options.workingDirectory,
      model,
      env,
      // Run non-interactively inside the worktree: never block on approvals.
      permissionMode: 'bypassPermissions',
      mcpServers: toMcpServers(options.mcpServers),
      abortController,
      ...(options.config as Partial<Options> | undefined),
    };
    if (options.threadId) built.resume = options.threadId;
    return built;
  }

  async run(prompt: string, options: HarnessRunOptions): Promise<HarnessTurnResult> {
    let result: HarnessTurnResult = { finalResponse: '', threadId: options.threadId, items: [] };
    for await (const event of this.runStreamed(prompt, options)) {
      if (event.type === 'message') result.finalResponse = event.text;
      else if (event.type === 'completed') result = event.result;
    }
    return result;
  }

  async *runStreamed(
    prompt: string,
    options: HarnessRunOptions,
  ): AsyncIterable<HarnessEvent> {
    const queryOptions = this.buildOptions(options);

    let accumulated = '';
    let finalResponse = '';
    let lastYieldedText: string | undefined;
    let threadId = options.threadId;
    let usage: HarnessUsage | undefined;
    const items: unknown[] = [];

    for await (const message of query({ prompt, options: queryOptions })) {
      switch (message.type) {
        case 'assistant': {
          threadId = message.session_id ?? threadId;
          const content = (message.message?.content ?? []) as ContentBlock[];
          for (const block of content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              accumulated = accumulated ? `${accumulated}\n${block.text}` : block.text;
              finalResponse = accumulated;
              lastYieldedText = accumulated;
              yield { type: 'message', text: accumulated };
            } else {
              items.push(block);
              yield { type: 'item', item: block };
            }
          }
          break;
        }
        case 'result': {
          threadId = message.session_id ?? threadId;
          usage = toHarnessUsage(message.usage, message.total_cost_usd);
          if (message.subtype === 'success' && typeof message.result === 'string') {
            finalResponse = message.result || finalResponse;
            if (finalResponse && finalResponse !== lastYieldedText) {
              lastYieldedText = finalResponse;
              yield { type: 'message', text: finalResponse };
            }
          } else if (message.is_error) {
            const detail =
              'errors' in message && Array.isArray(message.errors)
                ? message.errors.join('; ')
                : message.subtype;
            throw new Error(`Claude agent failed: ${detail}`);
          }
          break;
        }
        default:
          break;
      }
    }

    yield {
      type: 'completed',
      result: { finalResponse, threadId, items, usage },
    };
  }
}
