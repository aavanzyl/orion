import { randomUUID } from 'node:crypto';
import cronParser from 'cron-parser';
import { installSkillsIntoWorktree, listSkillCatalog, loadProjectConfig, listGlobalSkillCatalog } from '@orion/config';
import type {
  CreateScheduleInput,
  McpServer,
  McpServerConfig,
  McpServerMap,
  Project,
  ProjectConfig,
  Schedule,
  ScheduleOptions,
  UpdateScheduleInput,
} from '@orion/models';
import type { UpdateScheduleRow } from '@orion/db';
import type { Container } from '../container.js';
import { decrypt } from '../crypto.js';
import { WorkspaceService } from './workspace.service.js';

const { parseExpression } = cronParser;

/** Optional overrides supplied when firing a schedule manually. */
export interface ScheduleFirePayload {
  instruction?: string;
  [key: string]: unknown;
}

/** How often the scheduler wakes to look for due schedules. */
const SCHEDULER_INTERVAL_MS = 30_000;

/** Default agent properties when the project configures no agent node. */
const DEFAULT_PROVIDER = 'codex';
const DEFAULT_MODEL = 'gpt-5-codex';

const BRANCH_PREFIX = 'orion/schedule';

/**
 * Manages schedules — recurring cron jobs that run a single agent turn with a
 * custom instruction. A schedule has nothing to do with the board pipeline, but
 * the agent is always given the board (tickets) and codebase MCP servers, plus
 * any skills and registered MCP servers the schedule selects. Cron schedules are
 * polled by a lightweight in-process scheduler.
 */
export class ScheduleService {
  private readonly workspaces: WorkspaceService;
  private interval?: ReturnType<typeof setInterval>;
  /** Guards against overlapping scheduler ticks. */
  private ticking = false;

  constructor(private readonly c: Container) {
    this.workspaces = new WorkspaceService(c);
  }

  list(projectId: string): Promise<Schedule[]> {
    return this.c.schedules.list(projectId);
  }

  listAll(): Promise<Schedule[]> {
    return this.c.schedules.listAll();
  }

  get(id: string): Promise<Schedule | null> {
    return this.c.schedules.get(id);
  }

  /**
   * The skills and MCP servers a schedule can choose from for a project. Skill
   * names come from the project skill catalog merged with global skills; MCP
   * server names from the project config's `mcpServers` map plus global MCP
   * servers stored in the database and the built-in servers. Best-effort:
   * returns empty lists on any failure.
   */
  async options(project: Project): Promise<ScheduleOptions> {
    const configRoot = await this.workspaces.resolveConfigRoot(project).catch(() => null);
    if (!configRoot) {
      const [globalSkills, globalMcpServers] = await Promise.all([
        listGlobalSkillCatalog().catch(() => []),
        this.c.mcpServers.list().catch(() => []),
      ]);
      return {
        skills: globalSkills.map((s) => s.name),
        mcpServers: ['orion-codebase', 'orion-tickets', 'orion-skills'],
        globalMcpServers: globalMcpServers.map((s) => s.name),
      };
    }
    const [catalog, config, globalSkills, globalMcpServers] = await Promise.all([
      listSkillCatalog(configRoot, project.configPath).catch(() => []),
      loadProjectConfig(configRoot, project.configPath).catch(() => null),
      listGlobalSkillCatalog().catch(() => []),
      this.c.mcpServers.list().catch(() => []),
    ]);
    const projectSkillNames = new Set(catalog.map((s) => s.name));
    const mergedSkills = [
      ...catalog.map((s) => s.name),
      ...globalSkills.filter((s) => !projectSkillNames.has(s.name)).map((s) => s.name),
    ];
    return {
      skills: mergedSkills,
      mcpServers: [
        'orion-codebase',
        'orion-tickets',
        'orion-skills',
        ...(config?.mcpServers ? Object.keys(config.mcpServers) : []),
      ],
      globalMcpServers: globalMcpServers.map((s) => s.name),
    };
  }

  /** Create a schedule after validating its cron expression. */
  async create(input: CreateScheduleInput): Promise<Schedule> {
    const cron = input.cron?.trim();
    if (!cron) throw new Error('A schedule requires a cron expression');
    if (!input.instruction?.trim()) throw new Error('A schedule requires an instruction');
    this.validateCron(cron);
    return this.c.schedules.create({
      ...input,
      cron,
      instruction: input.instruction.trim(),
      nextFireAt: this.computeNextFire(cron),
    });
  }

  /** Update a schedule; recompute the next fire when the cron changes/enables. */
  async update(id: string, patch: UpdateScheduleInput): Promise<Schedule | null> {
    const existing = await this.c.schedules.get(id);
    if (!existing) return null;

    const row: UpdateScheduleRow = { ...patch };
    if (patch.cron !== undefined) {
      const cron = patch.cron.trim();
      if (!cron) throw new Error('A schedule requires a cron expression');
      this.validateCron(cron);
      row.cron = cron;
    }
    if (patch.instruction !== undefined) {
      const instruction = patch.instruction.trim();
      if (!instruction) throw new Error('A schedule requires an instruction');
      row.instruction = instruction;
    }

    const effectiveCron = row.cron ?? existing.cron;
    const enabling = patch.enabled === true && !existing.enabled;
    if (patch.cron !== undefined || enabling || !existing.nextFireAt) {
      row.nextFireAt = this.computeNextFire(effectiveCron);
    }
    return this.c.schedules.update(id, row);
  }

  delete(id: string): Promise<void> {
    return this.c.schedules.delete(id);
  }

  /**
   * Fire a schedule: run a single agent turn with its instruction in an isolated
   * worktree. The board (tickets) and codebase MCP servers are always injected
   * so the agent can read/write the board and search the repo; the schedule's
   * selected skills and MCP servers are added on top. Records the fire and the
   * next scheduled time. Returns the agent's final response.
   */
  async fire(schedule: Schedule, payload?: ScheduleFirePayload): Promise<string> {
    const project = await this.c.projects.get(schedule.projectId);
    if (!project) throw new Error(`Project ${schedule.projectId} not found`);

    this.c.bus.emit('schedule', {
      type: 'schedule.fired',
      scheduleId: schedule.id,
      projectId: schedule.projectId,
      name: schedule.name,
      instruction: schedule.instruction,
      createdAt: new Date().toISOString(),
    });

    try {
      const response = await this.runAgentTurn(schedule, project, payload);

      const now = new Date();
      await this.c.schedules.markFired(schedule.id, now, this.computeNextFire(schedule.cron, now));

      this.c.bus.emit('schedule', {
        type: 'schedule.completed',
        scheduleId: schedule.id,
        projectId: schedule.projectId,
        name: schedule.name,
        createdAt: new Date().toISOString(),
      });

      return response;
    } catch (err) {
      this.c.bus.emit('schedule', {
        type: 'schedule.failed',
        scheduleId: schedule.id,
        projectId: schedule.projectId,
        name: schedule.name,
        error: err instanceof Error ? err.message : String(err),
        createdAt: new Date().toISOString(),
      });
      throw err;
    }
  }

  /** Run the schedule's agent turn in a throwaway worktree. */
  private async runAgentTurn(
    schedule: Schedule,
    project: Project,
    payload?: ScheduleFirePayload,
  ): Promise<string> {
    const instruction = payloadString(payload?.instruction) ?? schedule.instruction.trim();
    if (!instruction) throw new Error('A schedule requires an instruction');

    const configRoot = await this.workspaces.resolveConfigRoot(project);
    const config = await loadProjectConfig(configRoot, project.configPath).catch(() => null);

    const agentNode = config?.workflow.nodes.find((n) => n.type === 'agent');
    const rawProvider = agentNode?.provider ?? DEFAULT_PROVIDER;
    const model = agentNode?.model ?? DEFAULT_MODEL;
    const nodeConfig = agentNode?.config;

    const { resolvedProvider, harness, baseUrl } = await this.resolveProvider(
      rawProvider,
      agentNode?.baseUrl,
    );

    const branch = `${BRANCH_PREFIX}/${schedule.id.slice(0, 8)}-${randomSuffix()}`;
    const { workspace, cleanup } = await this.workspaces.prepare(
      project,
      `schedule-${schedule.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`,
      branch,
    );

    try {
      await installSkillsIntoWorktree(
        workspace.configRoot,
        workspace.rootPath,
        schedule.skills,
        project.configPath,
      );

      const globalMcpServers = await this.c.mcpServers.list().catch(() => []);
      const oauthTokens = new Map<string, string>();
      for (const server of globalMcpServers) {
        if (server.authType === 'oauth') {
          try {
            const rawOauth = await this.c.mcpServers.getRawOauth(server.name);
            if (rawOauth?.accessToken) {
              const token = this.c.env.providerEncryptionSalt
                ? decrypt(rawOauth.accessToken, this.c.env.providerEncryptionSalt)
                : rawOauth.accessToken;
              oauthTokens.set(server.name, token);
            }
          } catch {
            // skip
          }
        }
      }
      const mcpServers = this.resolveMcpServers(schedule, project, config, globalMcpServers, oauthTokens);

      const result = await harness.run(instruction, {
        workingDirectory: workspace.rootPath,
        model,
        baseUrl,
        apiKey: await this.resolveApiKey(resolvedProvider),
        mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
        config: nodeConfig,
      });
      return result.finalResponse;
    } finally {
      await cleanup().catch(() => undefined);
    }
  }

  private resolveMcpServers(
    schedule: Schedule,
    project: Project,
    config: ProjectConfig | null,
    globalMcpServers: McpServer[] = [],
    oauthTokens: Map<string, string> = new Map(),
  ): McpServerMap {
    const servers: McpServerMap = {
      'orion-codebase': { url: `${this.c.env.publicUrl}/mcp/codebase?projectId=${project.id}` },
      'orion-tickets': { url: `${this.c.env.publicUrl}/mcp/tickets?projectId=${project.id}` },
      'orion-skills': { url: `${this.c.env.publicUrl}/mcp/skills?projectId=${project.id}` },
    };
    for (const name of schedule.mcpServers) {
      const cfg =
        config?.mcpServers?.[name] ??
        toMcpConfig(globalMcpServers.find((s) => s.name === name), oauthTokens) ??
        schedule.mcpServerConfigs?.[name];
      if (cfg) servers[name] = cfg;
    }
    return servers;
  }

  /** Start polling for due schedules. Idempotent. */
  async startScheduler(): Promise<void> {
    await this.backfillNextFire();
    if (this.interval) return;
    this.interval = setInterval(() => {
      void this.tick();
    }, SCHEDULER_INTERVAL_MS);
    // Never keep the process alive solely for the scheduler.
    this.interval.unref?.();
  }

  stopScheduler(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  /** One scheduler pass: fire every enabled schedule that is due. */
  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const enabled = await this.c.schedules.listAllEnabled();
      const due = enabled.filter((s) => s.nextFireAt && new Date(s.nextFireAt).getTime() <= now);
      for (const schedule of due) {
        try {
          await this.fire(schedule);
        } catch (err) {
          console.error(`[ orion orchestrator ] schedule ${schedule.id} failed to fire:`, err);
          // Advance the schedule so a persistently broken one cannot hot-loop.
          await this.c.schedules
            .markFired(schedule.id, new Date(), this.computeNextFire(schedule.cron))
            .catch(() => undefined);
        }
      }
    } catch (err) {
      console.error('[ orion orchestrator ] schedule scheduler tick failed:', err);
    } finally {
      this.ticking = false;
    }
  }

  /** Seed `nextFireAt` for any enabled schedule missing it (e.g. new rows). */
  private async backfillNextFire(): Promise<void> {
    const enabled = await this.c.schedules.listAllEnabled();
    for (const schedule of enabled) {
      if (schedule.nextFireAt) continue;
      try {
        await this.c.schedules.update(schedule.id, {
          nextFireAt: this.computeNextFire(schedule.cron),
        });
      } catch (err) {
        console.error(
          `[ orion orchestrator ] failed to backfill next fire for schedule ${schedule.id}:`,
          err,
        );
      }
    }
  }

  private validateCron(expression: string): void {
    try {
      parseExpression(expression);
    } catch {
      throw new Error(`Invalid cron expression: ${expression}`);
    }
  }

  private computeNextFire(expression: string, from: Date = new Date()): Date {
    return parseExpression(expression, { currentDate: from }).next().toDate();
  }

  /**
   * Resolve a provider name (from the project workflow config) to an actual
   * harness instance, harness key, and base URL. When the name is a known
   * harness (e.g. "codex") it is used directly; otherwise a DB provider record
   * is consulted to find the backing harness and its stored base URL.
   */
  private async resolveProvider(
    providerName: string,
    nodeBaseUrl?: string,
  ): Promise<{
    resolvedProvider: string;
    harness: import('@orion/harness-core').AgentProvider;
    baseUrl?: string;
  }> {
    let resolvedProvider = providerName;
    let harness: import('@orion/harness-core').AgentProvider | undefined;
    let baseUrl: string | undefined = nodeBaseUrl;

    if (this.c.harnesses.has(providerName)) {
      harness = this.c.harnesses.get(providerName);
      baseUrl =
        baseUrl ??
        (providerName === 'codex'
          ? this.c.env.codexBaseUrl
          : providerName === 'claude'
            ? this.c.env.claudeBaseUrl
            : undefined);
    } else {
      const dbProvider = await this.resolveDbProvider(providerName);
      if (dbProvider?.harness && this.c.harnesses.has(dbProvider.harness)) {
        resolvedProvider = dbProvider.harness;
        harness = this.c.harnesses.get(dbProvider.harness);
        baseUrl =
          baseUrl ??
          dbProvider.baseUrl ??
          (dbProvider.harness === 'codex'
            ? this.c.env.codexBaseUrl
            : dbProvider.harness === 'claude'
              ? this.c.env.claudeBaseUrl
              : undefined);
      }
    }

    if (!harness) {
      const keys = this.c.harnesses.keys();
      if (keys.length === 0) throw new Error('No harness providers registered');
      harness = this.c.harnesses.get(keys[0]);
    }

    return { resolvedProvider, harness, baseUrl };
  }

  private async resolveDbProvider(providerKey: string) {
    const allProviders = await this.c.providers.list().catch(() => []);
    return allProviders.find((p) => p.key === providerKey);
  }

  private async resolveApiKey(harnessKey: string): Promise<string | undefined> {
    const allProviders = await this.c.providers.list().catch(() => []);
    const matching = allProviders.find((p) => p.harness === harnessKey);
    if (matching) {
      const stored = await this.c.providers.getApiKey(matching.id).catch(() => null);
      if (stored) {
        return this.c.env.providerEncryptionSalt
          ? decrypt(stored, this.c.env.providerEncryptionSalt)
          : stored;
      }
    }
    if (harnessKey === 'codex') return this.c.env.codexApiKey;
    if (harnessKey === 'claude') return this.c.env.claudeApiKey;
    return undefined;
  }
}

function payloadString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function randomSuffix(length = 4): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + length);
}

function toMcpConfig(
  server: McpServer | undefined,
  oauthTokens: Map<string, string> = new Map(),
): McpServerConfig | undefined {
  if (!server) return undefined;
  const cfg: McpServerConfig = { ...server.config };
  if (server.authType === 'bearer' && cfg.url) {
    cfg.bearerToken = cfg.bearerToken ?? '';
  } else if (server.authType === 'oauth' && cfg.url) {
    const token = oauthTokens.get(server.name);
    if (token) cfg.bearerToken = token;
  }
  return cfg;
}
