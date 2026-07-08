import type { NodeExecutor, NodeExecutionContext, NodeOutcome } from '@orion/workflow-engine';
import type { HarnessRegistry, HarnessUsage } from '@orion/harness-core';
import type { TicketRepository } from '@orion/db';
import { buildStructuredOutputInstruction, ConfigError, extractJson, installSkillsIntoWorktree, renderCommand, renderTemplate, validateStructuredOutput } from '@orion/config';
import type { McpServerMap, SearchResult } from '@orion/models';
import type { OrionEnv } from '../env.js';

const DEFAULT_PROMPT =
  'You are working on the following ticket. Investigate the repository and make the necessary code changes.\n\nTitle: $TICKET_TITLE\n\n$ARGUMENTS';

/** Retrieves top-K codebase search results for RAG prompt injection. */
export type SearchFn = (projectId: string, query: string, topK: number) => Promise<SearchResult[]>;

/**
 * Executes an `agent` node by running the configured harness (e.g. Codex) inside
 * the run's isolated worktree, streaming progress back as run events.
 */
export class AgentNodeExecutor implements NodeExecutor {
  readonly type = 'agent' as const;

  constructor(
    private readonly harnesses: HarnessRegistry,
    private readonly tickets: TicketRepository,
    private readonly env: OrionEnv,
    private readonly search?: SearchFn,
  ) {}

  async execute(ctx: NodeExecutionContext): Promise<NodeOutcome> {
    const nodeConfig = ctx.nodeConfig;
    const provider = nodeConfig.provider;
    if (!provider) {
      return { status: 'failed', error: `Agent node "${nodeConfig.id}" has no provider set` };
    }

    const ticket = await this.tickets.get(ctx.ticketId);
    if (!ticket) {
      return {
        status: 'failed',
        error: `Ticket ${ctx.ticketId} not found`,
        telemetry: { agentId: nodeConfig.id, model: nodeConfig.model },
      };
    }

    const variables: Record<string, string> = {
      ARGUMENTS: `${ticket.title}\n\n${ticket.description}`.trim(),
      TICKET_TITLE: ticket.title,
      REPOSITORY: ctx.config.project.name,
      REPOSITORIES: ctx.workspace.repos.map((r) => r.name).join(', '),
      BASE_BRANCH: ctx.config.project.defaultBranch,
      BRANCH: ctx.workspace.repos[0]?.branch ?? '',
      WORKFLOW_ID: ctx.run.id,
    };

    let scope: Record<string, unknown> | undefined;
    if (ctx.matrix) {
      const itemStr =
        typeof ctx.matrix.item === 'string' ? ctx.matrix.item : JSON.stringify(ctx.matrix.item);
      const name = ctx.matrix.as ?? 'item';
      scope = {
        matrix: {
          item: ctx.matrix.item,
          index: ctx.matrix.index,
          total: ctx.matrix.total,
          [name]: ctx.matrix.item,
        },
      };
      variables.MATRIX_ITEM = itemStr;
      variables.MATRIX_INDEX = String(ctx.matrix.index);
      variables.MATRIX_TOTAL = String(ctx.matrix.total);
      variables[name.toUpperCase()] = itemStr;
    }

    const instructions = nodeConfig.instructions;
    let prompt: string;
    if (instructions) {
      if (instructions.includes('\n')) {
        prompt = renderTemplate(instructions, variables, ctx.nodeOutputs, scope);
      } else {
        try {
          prompt = await renderCommand(ctx.workspace.configRoot, instructions, variables, undefined, ctx.nodeOutputs, scope);
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (code === 'ENOENT') {
            prompt = renderTemplate(instructions, variables, ctx.nodeOutputs, scope);
          } else {
            throw err;
          }
        }
      }
    } else {
      // Backward compatibility with deprecated `command` and `prompt` fields.
      const commandPath = nodeConfig.command;
      if (nodeConfig.prompt) {
        prompt = renderTemplate(nodeConfig.prompt, variables, ctx.nodeOutputs, scope);
      } else if (commandPath) {
        prompt = await renderCommand(ctx.workspace.configRoot, commandPath, variables, undefined, ctx.nodeOutputs, scope);
      } else {
        prompt = renderTemplate(DEFAULT_PROMPT, variables, ctx.nodeOutputs, scope);
      }
    }

    if (ctx.nodeConfig.structuredOutput) {
      prompt += buildStructuredOutputInstruction(ctx.nodeConfig.structuredOutput);
    }

    // Optional codebase retrieval: prepend top-K search hits as context. Never
    // fail the node if search is unavailable, empty or errors — just skip.
    if (ctx.nodeConfig.retrieval && this.search) {
      const context = await this.buildRetrievalContext(ctx, `${ticket.title}\n\n${ticket.description}`.trim());
      if (context) {
        await ctx.emit('log', { agent: nodeConfig.id, message: 'Injected codebase retrieval context' });
        prompt = `${context}\n\n${prompt}`;
      }
    }

    // Materialize the agent's selected skills into the run's worktree so the
    // harness discovers them natively (via .orion/skills/ and AGENTS.md).
    try {
      const materialized = await installSkillsIntoWorktree(
        ctx.workspace.configRoot,
        ctx.workspace.rootPath,
        nodeConfig.skills,
      );
      if (materialized.length > 0) {
        await ctx.emit('log', { agent: nodeConfig.id, message: `Loaded skills: ${materialized.join(', ')}` });
      }
    } catch (err) {
      if (err instanceof ConfigError) {
        return { status: 'failed', error: err.message };
      }
      throw err;
    }

    const harness = this.harnesses.get(provider);

    // Auto-inject the codebase MCP (SSE) so running agents can search the repo.
    // On by default; node/project config of the same name overrides or disables it.
    const injected: McpServerMap = this.env.codebaseMcpEnabled
      ? {
          'orion-codebase': {
            url: `${this.env.publicUrl}/mcp/codebase?projectId=${ctx.run.projectId}`,
          },
        }
      : {};

    // Global MCP servers apply to every agent; the node's own servers are
    // merged on top so a node can add to or override the shared set by name.
    const mcpServers = {
      ...injected,
      ...ctx.config.mcpServers,
      ...nodeConfig.mcpServers,
    };

    let finalResponse = '';
    const startThreadId = ctx.nodeConfig.loop?.freshContext ? undefined : ctx.run.threadId;
    let threadId = startThreadId;
    let usage: HarnessUsage | undefined;

    const stream = harness.runStreamed(prompt, {
      workingDirectory: ctx.workspace.rootPath,
      model: nodeConfig.model,
      baseUrl: nodeConfig.baseUrl ?? this.resolveBaseUrl(nodeConfig),
      apiKey: this.env.codexApiKey,
      threadId: startThreadId,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      config: nodeConfig.config,
      signal: ctx.signal,
    });

    for await (const event of stream) {
      if (event.type === 'message') {
        finalResponse = event.text;
        await ctx.emit('agent.message', { agent: nodeConfig.id, text: event.text });
      } else if (event.type === 'item') {
        await ctx.emit('agent.item', { agent: nodeConfig.id, item: event.item });
      } else if (event.type === 'completed') {
        finalResponse = event.result.finalResponse || finalResponse;
        threadId = event.result.threadId ?? threadId;
        usage = event.result.usage;
      }
    }

    if (usage) {
      await ctx.emit('agent.usage', { agent: nodeConfig.id, usage });
    }

    const telemetry = { agentId: nodeConfig.id, model: nodeConfig.model };

    if (ctx.nodeConfig.structuredOutput) {
      const parsed = extractJson(finalResponse);
      if (parsed === undefined) {
        return {
          status: 'failed',
          error: 'structured output invalid: no JSON object found in response',
          telemetry: { ...telemetry, structuredOutputValid: false },
        };
      }
      const validation = validateStructuredOutput(parsed, ctx.nodeConfig.structuredOutput);
      if (!validation.ok) {
        return {
          status: 'failed',
          error: `structured output invalid: ${validation.error}`,
          telemetry: { ...telemetry, structuredOutputValid: false },
        };
      }
      await ctx.emit('agent.structured', { agent: nodeConfig.id, data: validation.data });
      return {
        status: 'completed',
        output: { finalResponse, data: validation.data },
        threadId,
        usage,
        telemetry: { ...telemetry, structuredOutputValid: true },
      };
    }

    return { status: 'completed', output: { finalResponse }, threadId, usage, telemetry };
  }

  private resolveBaseUrl(nodeConfig: { baseUrl?: string }): string | undefined {
    return nodeConfig.baseUrl ?? this.env.codexBaseUrl;
  }

  /**
   * Build a "Relevant code context" block from codebase search, or `undefined`
   * when disabled, unavailable or empty. Errors are swallowed so retrieval can
   * never fail the node.
   */
  private async buildRetrievalContext(
    ctx: NodeExecutionContext,
    fallbackQuery: string,
  ): Promise<string | undefined> {
    const retrieval = ctx.nodeConfig.retrieval;
    if (!retrieval || !this.search) return undefined;
    const query = (retrieval.query ?? fallbackQuery).trim();
    if (!query) return undefined;
    try {
      const results = await this.search(ctx.run.projectId, query, retrieval.topK ?? 8);
      if (results.length === 0) return undefined;
      const blocks = results.map(
        (r) => `--- ${r.filePath}:${r.startLine}-${r.endLine} (score ${r.score.toFixed(3)})\n${r.snippet}`,
      );
      return `Relevant code context:\n${blocks.join('\n\n')}`;
    } catch {
      return undefined;
    }
  }
}
