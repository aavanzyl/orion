import type { NodeExecutor, NodeExecutionContext, NodeOutcome } from '@orion/workflow-engine';
import type { HarnessRegistry, HarnessUsage } from '@orion/harness-core';
import type { ProviderRepository, TicketRepository } from '@orion/db';
import { ConfigError, installSkillsIntoWorktree, renderCommand, renderTemplate } from '@orion/config';
import type { McpServerMap } from '@orion/models';
import { decrypt } from '../crypto.js';
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
    private readonly providers: ProviderRepository,
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

    if (ctx.node.input !== undefined && ctx.node.input !== null) {
      scope = { ...scope, input: ctx.node.input };
    }

    const instructions = nodeConfig.instructions;
    let prompt: string;
    if (instructions) {
      if (instructions.includes('\n')) {
        prompt = renderTemplate(instructions, variables, ctx.nodeOutputs, scope);
      } else {
        const looksLikeFilePath = instructions.endsWith('.md') ||
          instructions.startsWith('instructions/') ||
          instructions.startsWith('./') ||
          instructions.startsWith('../');
        try {
          prompt = await renderCommand(ctx.workspace.configRoot, instructions, variables, undefined, ctx.nodeOutputs, scope);
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (code === 'ENOENT') {
            if (looksLikeFilePath) {
              return {
                status: 'failed',
                error: `instructions file "${instructions}" not found under .orion/ — create it or switch the node to inline instructions`,
              };
            }
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

    let harness;
    let resolvedProvider = provider;

    if (this.harnesses.has(provider)) {
      harness = this.harnesses.get(provider);
    } else {
      // The node's `provider` may be a human-readable key (e.g. "deepseek")
      // that maps to a DB provider record specifying the actual harness.
      const dbProvider = await this.resolveDbProvider(provider);
      if (dbProvider?.harness) {
        resolvedProvider = dbProvider.harness;
        if (this.harnesses.has(dbProvider.harness)) {
          harness = this.harnesses.get(dbProvider.harness);
        }
      }
      if (!harness) {
        const keys = this.harnesses.keys();
        if (keys.length === 0) throw new Error('No harness providers registered');
        harness = this.harnesses.get(keys[0]);
      }
    }

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

    const resolvedApiKey = await this.resolveApiKey(resolvedProvider);
    const resolvedBaseUrl = nodeConfig.baseUrl ?? await this.resolveBaseUrlFromProvider(provider) ?? this.env.codexBaseUrl;
    const stream = harness.runStreamed(prompt, {
      workingDirectory: ctx.workspace.rootPath,
      model: nodeConfig.model,
      baseUrl: resolvedBaseUrl,
      apiKey: resolvedApiKey,
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

    // Emit the agent's final output as a comment on the ticket.
    if (finalResponse) {
      await ctx.emit('ticket.comment', {
        body: finalResponse,
        agent: nodeConfig.id,
        model: nodeConfig.model,
      });
    }

    const telemetry = { agentId: nodeConfig.id, model: nodeConfig.model };

    return { status: 'completed', output: { finalResponse }, threadId, usage, telemetry };
  }

  /**
   * Look up a DB provider record by its `key` (not harness). Returns the
   * provider if found, or undefined.
   */
  private async resolveDbProvider(providerKey: string) {
    const allProviders = await this.providers.list().catch(() => []);
    return allProviders.find((p) => p.key === providerKey);
  }

  /**
   * Resolve the base URL from the configured DB provider, falling back to env.
   */
  private async resolveBaseUrlFromProvider(providerKey: string): Promise<string | undefined> {
    const dbProvider = await this.resolveDbProvider(providerKey);
    if (dbProvider?.baseUrl) return dbProvider.baseUrl;
    if (providerKey === 'codex') return this.env.codexBaseUrl;
    if (providerKey === 'claude') return this.env.claudeBaseUrl;
    return undefined;
  }

  /**
   * Look up the API key from the configured provider entry in the database.
   * Falls back to the environment variable key for the given harness.
   */
  private async resolveApiKey(harnessKey: string): Promise<string | undefined> {
    const allProviders = await this.providers.list().catch(() => []);
    const matching = allProviders.find((p) => p.harness === harnessKey);
    if (matching) {
      const stored = await this.providers.getApiKey(matching.id).catch(() => null);
      if (stored) {
        return this.env.providerEncryptionSalt
          ? decrypt(stored, this.env.providerEncryptionSalt)
          : stored;
      }
    }
    if (harnessKey === 'codex') return this.env.codexApiKey;
    if (harnessKey === 'claude') return this.env.claudeApiKey;
    return undefined;
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
      'orion-skills': 'skills',
    };
    const kind = kinds[name];
    return kind ? `${this.env.publicUrl}/mcp/${kind}?projectId=${projectId}` : undefined;
  }
}
