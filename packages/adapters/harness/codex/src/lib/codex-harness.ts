import {
  Codex,
  type CodexOptions,
  type Thread,
  type ThreadEvent,
  type ThreadItem,
  type Usage,
} from '@openai/codex-sdk';
import type {
  AgentProvider,
  HarnessEvent,
  HarnessRunOptions,
  HarnessTurnResult,
  HarnessUsage,
} from '@orion/harness-core';

/** Map the Codex SDK's per-turn `Usage` into the harness-neutral shape. */
function toHarnessUsage(usage: Usage | null | undefined): HarnessUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens: usage.cached_input_tokens,
  };
}

export interface CodexHarnessDefaults {
  /** Fallback API key when a run does not supply one. */
  apiKey?: string;
  /** Fallback base URL for OpenAI-compatible providers (e.g. DeepSeek). */
  baseUrl?: string;
  /** Default model when a run/agent does not specify one. */
  model?: string;
}

/**
 * Codex execution harness. Wraps `@openai/codex-sdk`, running the agent inside
 * an isolated git worktree. Supports OpenAI, DeepSeek and any OpenAI-compatible
 * endpoint via `baseUrl`, and streams normalized events for the Kanban UI.
 */
export class CodexHarness implements AgentProvider {
  readonly key = 'codex';

  constructor(private readonly defaults: CodexHarnessDefaults = {}) {}

  private createThread(options: HarnessRunOptions): Thread {
    const codex = new Codex({
      apiKey: options.apiKey ?? this.defaults.apiKey,
      baseUrl: options.baseUrl ?? this.defaults.baseUrl,
      config: this.buildConfig(options),
    });

    const threadOptions = {
      model: options.model ?? this.defaults.model,
      workingDirectory: options.workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode: 'workspace-write' as const,
      approvalPolicy: 'never' as const,
    };

    return options.threadId
      ? codex.resumeThread(options.threadId, threadOptions)
      : codex.startThread(threadOptions);
  }

  /**
   * Merges free-form provider `config` with any MCP servers, translating the
   * latter into Codex's `mcp_servers` config table (`--config` overrides).
   */
  private buildConfig(options: HarnessRunOptions): CodexOptions['config'] {
    const config = { ...(options.config as Record<string, unknown> | undefined) };

    if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
      const mcpServers: Record<string, Record<string, unknown>> = {};
      for (const [name, server] of Object.entries(options.mcpServers)) {
        const entry: Record<string, unknown> = {};
        if (server.command !== undefined) entry.command = server.command;
        if (server.args !== undefined) entry.args = server.args;
        if (server.env !== undefined) entry.env = server.env;
        if (server.url !== undefined) entry.url = server.url;
        if (server.bearerToken !== undefined) entry.bearer_token = server.bearerToken;
        mcpServers[name] = entry;
      }
      config.mcp_servers = {
        ...(config.mcp_servers as Record<string, unknown> | undefined),
        ...mcpServers,
      };
    }

    return config as CodexOptions['config'];
  }

  async run(prompt: string, options: HarnessRunOptions): Promise<HarnessTurnResult> {
    const thread = this.createThread(options);
    const turn = await thread.run(prompt, { signal: options.signal });
    return {
      finalResponse: turn.finalResponse,
      threadId: thread.id ?? options.threadId,
      items: turn.items,
      usage: toHarnessUsage(turn.usage),
    };
  }

  async *runStreamed(
    prompt: string,
    options: HarnessRunOptions,
  ): AsyncIterable<HarnessEvent> {
    const thread = this.createThread(options);
    const { events } = await thread.runStreamed(prompt, { signal: options.signal });

    let finalResponse = '';
    const items: ThreadItem[] = [];
    let usage: HarnessUsage | undefined;

    for await (const event of events as AsyncGenerator<ThreadEvent>) {
      switch (event.type) {
        case 'item.completed': {
          items.push(event.item);
          if (event.item.type === 'agent_message') {
            finalResponse = event.item.text;
            yield { type: 'message', text: event.item.text };
          } else {
            yield { type: 'item', item: event.item };
          }
          break;
        }
        case 'item.started':
        case 'item.updated': {
          yield { type: 'item', item: event.item };
          break;
        }
        case 'turn.completed': {
          usage = toHarnessUsage(event.usage);
          break;
        }
        case 'turn.failed': {
          throw new Error(event.error.message);
        }
        case 'error': {
          throw new Error(event.message);
        }
        default:
          break;
      }
    }

    yield {
      type: 'completed',
      result: {
        finalResponse,
        threadId: thread.id ?? options.threadId,
        items,
        usage,
      },
    };
  }
}
