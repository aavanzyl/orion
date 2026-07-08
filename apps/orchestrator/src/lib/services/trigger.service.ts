import { randomBytes } from 'node:crypto';
import cronParser from 'cron-parser';
import { loadProjectConfig } from '@orion/config';
import type {
  CreateTriggerInput,
  Project,
  Trigger,
  UpdateTriggerInput,
  WorkflowRun,
} from '@orion/models';
import type { UpdateTriggerRow } from '@orion/db';
import type { Container } from '../container.js';
import { ProjectService } from './project.service.js';
import { WorkspaceService } from './workspace.service.js';
import type { RunService } from './run.service.js';

const { parseExpression } = cronParser;

/** Payload accompanying a fire — a webhook body or manual invocation. */
export interface TriggerFirePayload {
  title?: string;
  description?: string;
  prompt?: string;
  [key: string]: unknown;
}

/** The result of firing a trigger, discriminated by the trigger's action. */
export type TriggerFireResult =
  | { kind: 'workflow'; run: WorkflowRun }
  | { kind: 'agent'; agentResponse: string };

/** Thrown when a webhook token resolves to no enabled webhook trigger. */
export class TriggerNotFoundError extends Error {}

/** How often the cron scheduler wakes to look for due triggers. */
const SCHEDULER_INTERVAL_MS = 30_000;

/** Default agent properties for an `agent` trigger when the project configures none. */
const DEFAULT_TRIGGER_PROVIDER = 'codex';
const DEFAULT_TRIGGER_MODEL = 'gpt-5-codex';

/**
 * Manages triggers — schedules and inbound webhooks that auto-create a ticket
 * and start a run of the project's workflow. Cron triggers are polled by a
 * lightweight in-process scheduler; webhook triggers fire on demand.
 */
export class TriggerService {
  private readonly projects: ProjectService;
  private readonly workspaces: WorkspaceService;
  private interval?: ReturnType<typeof setInterval>;
  /** Guards against overlapping scheduler ticks. */
  private ticking = false;

  constructor(
    private readonly c: Container,
    private readonly runs: RunService,
  ) {
    this.projects = new ProjectService(c);
    this.workspaces = new WorkspaceService(c);
  }

  list(projectId: string): Promise<Trigger[]> {
    return this.c.triggers.list(projectId);
  }

  get(id: string): Promise<Trigger | null> {
    return this.c.triggers.get(id);
  }

  /** Create a trigger, validating cron expressions and minting webhook tokens. */
  async create(input: CreateTriggerInput): Promise<Trigger> {
    if (input.action === 'agent' && !input.prompt?.trim()) {
      throw new Error('An agent trigger requires a prompt');
    }
    if (input.type === 'cron') {
      const cron = input.cron?.trim();
      if (!cron) throw new Error('A cron trigger requires a cron expression');
      this.validateCron(cron);
      return this.c.triggers.create({ ...input, cron, nextFireAt: this.computeNextFire(cron) });
    }
    return this.c.triggers.create({ ...input, webhookToken: randomBytes(24).toString('hex') });
  }

  /** Update a trigger; recompute the next cron fire when the schedule changes. */
  async update(id: string, patch: UpdateTriggerInput): Promise<Trigger | null> {
    const existing = await this.c.triggers.get(id);
    if (!existing) return null;

    const row: UpdateTriggerRow = { ...patch };
    if (existing.type === 'cron') {
      const effectiveCron = (patch.cron ?? existing.cron)?.trim();
      if (patch.cron !== undefined) {
        if (!effectiveCron) throw new Error('A cron trigger requires a cron expression');
        this.validateCron(effectiveCron);
        row.cron = effectiveCron;
      }
      const enabling = patch.enabled === true && !existing.enabled;
      if (effectiveCron && (patch.cron !== undefined || enabling || !existing.nextFireAt)) {
        row.nextFireAt = this.computeNextFire(effectiveCron);
      }
    }
    return this.c.triggers.update(id, row);
  }

  delete(id: string): Promise<void> {
    return this.c.triggers.delete(id);
  }

  /**
   * Fire a trigger. For `workflow` actions this creates a ticket and starts a
   * run of the project's workflow; for `agent` actions it runs a single, one-off
   * agent turn with the trigger's prompt (nothing is placed on the board unless
   * the agent files a ticket itself via the Tickets MCP). Records the fire and,
   * for cron triggers, the next scheduled time.
   */
  async fire(trigger: Trigger, payload?: TriggerFirePayload): Promise<TriggerFireResult> {
    const project = await this.c.projects.get(trigger.projectId);
    if (!project) throw new Error(`Project ${trigger.projectId} not found`);

    const result: TriggerFireResult =
      trigger.action === 'agent'
        ? { kind: 'agent', agentResponse: await this.runAgentTurn(trigger, project, payload) }
        : { kind: 'workflow', run: await this.runWorkflow(trigger, project, payload) };

    const now = new Date();
    const next =
      trigger.type === 'cron' && trigger.cron ? this.computeNextFire(trigger.cron, now) : null;
    await this.c.triggers.markFired(trigger.id, now, next);

    return result;
  }

  /** Create a ticket from the trigger + payload and start a workflow run. */
  private async runWorkflow(
    trigger: Trigger,
    project: Project,
    payload?: TriggerFirePayload,
  ): Promise<WorkflowRun> {
    const title = payloadString(payload?.title) ?? trigger.ticketTitle ?? trigger.name;
    const description = payloadString(payload?.description) ?? trigger.ticketDescription;
    const swimlane = trigger.swimlane ?? (await this.firstSwimlane(project));

    const ticket = await this.c.boards.get(project.boardProvider).createTicket({
      projectId: project.id,
      title,
      description,
      swimlane,
    });

    return this.runs.start(ticket.id);
  }

  /**
   * Run a single agent turn in the project workspace with the trigger's prompt.
   * The codebase + tickets MCP servers are injected so the agent can search the
   * repository and file tickets. Mirrors {@link ChatService}'s option assembly.
   */
  private async runAgentTurn(
    trigger: Trigger,
    project: Project,
    payload?: TriggerFirePayload,
  ): Promise<string> {
    const prompt = payloadString(payload?.prompt) ?? trigger.prompt?.trim();
    if (!prompt) throw new Error('An agent trigger requires a prompt');

    const configRoot = await this.workspaces.resolveConfigRoot(project);
    const config = await loadProjectConfig(configRoot, project.configPath).catch(() => null);

    // Look up the agent node by trigger's agentId, or use the first agent node, or defaults.
    const agentNode = (() => {
      if (trigger.agentId && config) {
        const found = config.workflow.nodes.find((n) => n.type === 'agent' && n.id === trigger.agentId);
        if (found) return found;
      }
      if (config) {
        const first = config.workflow.nodes.find((n) => n.type === 'agent');
        if (first) return first;
      }
      return null;
    })();

    const provider = agentNode?.provider ?? DEFAULT_TRIGGER_PROVIDER;
    const model = agentNode?.model ?? DEFAULT_TRIGGER_MODEL;
    const baseUrl = agentNode?.baseUrl ?? this.c.env.codexBaseUrl;
    const nodeConfig = agentNode?.config;

    const harness = this.c.harnesses.get(provider);

    const mcpServers = {
      'orion-codebase': { url: `${this.c.env.publicUrl}/mcp/codebase?projectId=${project.id}` },
      'orion-tickets': { url: `${this.c.env.publicUrl}/mcp/tickets?projectId=${project.id}` },
      ...config?.mcpServers,
      ...agentNode?.mcpServers,
    };

    const result = await harness.run(prompt, {
      workingDirectory: configRoot,
      model,
      baseUrl,
      apiKey: this.c.env.codexApiKey,
      mcpServers,
      config: nodeConfig,
    });

    return result.finalResponse;
  }

  /** Resolve an enabled webhook trigger by token and fire it. */
  async fireByWebhookToken(
    token: string,
    payload: TriggerFirePayload,
  ): Promise<TriggerFireResult> {
    const trigger = await this.c.triggers.getByWebhookToken(token);
    if (!trigger || trigger.type !== 'webhook' || !trigger.enabled) {
      throw new TriggerNotFoundError('Webhook trigger not found or disabled');
    }
    return this.fire(trigger, payload);
  }

  /** Start polling for due cron triggers. Idempotent. */
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

  /** One scheduler pass: fire every enabled cron trigger that is due. */
  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const enabled = await this.c.triggers.listAllEnabled();
      const due = enabled.filter(
        (t) =>
          t.type === 'cron' && t.cron && t.nextFireAt && new Date(t.nextFireAt).getTime() <= now,
      );
      for (const trigger of due) {
        try {
          await this.fire(trigger);
        } catch (err) {
          console.error(`[ orion orchestrator ] trigger ${trigger.id} failed to fire:`, err);
          // Advance the schedule so a persistently broken trigger cannot hot-loop.
          const next = trigger.cron ? this.computeNextFire(trigger.cron) : null;
          await this.c.triggers.markFired(trigger.id, new Date(), next).catch(() => undefined);
        }
      }
    } catch (err) {
      console.error('[ orion orchestrator ] trigger scheduler tick failed:', err);
    } finally {
      this.ticking = false;
    }
  }

  /** Seed `nextFireAt` for any enabled cron trigger missing it (e.g. new rows). */
  private async backfillNextFire(): Promise<void> {
    const enabled = await this.c.triggers.listAllEnabled();
    for (const trigger of enabled) {
      if (trigger.type !== 'cron' || !trigger.cron || trigger.nextFireAt) continue;
      try {
        await this.c.triggers.update(trigger.id, { nextFireAt: this.computeNextFire(trigger.cron) });
      } catch (err) {
        console.error(
          `[ orion orchestrator ] failed to backfill next fire for trigger ${trigger.id}:`,
          err,
        );
      }
    }
  }

  /** The trigger's target swimlane, defaulting to the project's first board swimlane. */
  private async firstSwimlane(project: Project): Promise<string | undefined> {
    const config = await this.projects.loadConfig(project).catch(() => null);
    return config?.board.swimlanes[0];
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
}

function payloadString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
