import type { NodeExecutor, NodeExecutionContext, NodeOutcome } from '@orion/workflow-engine';
import type { HarnessRegistry, HarnessUsage } from '@orion/harness-core';
import type { TicketRepository } from '@orion/db';
import { ConfigError, installSkillsIntoWorktree, renderCommand, renderTemplate } from '@orion/config';
import type { McpServerMap } from '@orion/models';
import type { OrionEnv } from '../env.js';

const DEFAULT_PROMPT =
  'You are working on the following ticket. Investigate the repository and make the necessary code changes.\n\nTitle: $TICKET_TITLE\n\n$ARGUMENTS';

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
    const mcpServers: McpServerMap = {
      ...injected,
      ...ctx.config.mcpServers,
      ...nodeConfig.mcpServers,
    };

    // Built-in Orion servers (codebase, tickets) can be opted into per node from
    // the config's MCP catalog. Their stored URL is only a placeholder — always
    // resolve it to this orchestrator's public URL and bind the run's project so
    // the agent's tools work without passing an explicit id.
    for (const name of Object.keys(mcpServers)) {
      const url = this.builtinMcpUrl(name, ctx.run.projectId);
      if (url) mcpServers[name] = { url };
    }

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

    return { status: 'completed', output: { finalResponse }, threadId, usage, telemetry };
  }

  private resolveBaseUrl(nodeConfig: { baseUrl?: string }): string | undefined {
    return nodeConfig.baseUrl ?? this.env.codexBaseUrl;
  }

  /**
   * Resolve a built-in Orion MCP server name to its runtime SSE URL, binding the
   * run's project so the agent's tools work without an explicit id. Returns
   * `undefined` for any name that is not a built-in server.
   */
  private builtinMcpUrl(name: string, projectId: string): string | undefined {
    const kinds: Record<string, string> = {
      'orion-codebase': 'codebase',
      'orion-tickets': 'tickets',
    };
    const kind = kinds[name];
    return kind ? `${this.env.publicUrl}/mcp/${kind}?projectId=${projectId}` : undefined;
  }
}
