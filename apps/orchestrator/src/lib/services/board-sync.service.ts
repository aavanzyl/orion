import { createLinearClient } from '@orion/board-linear';
import { createJiraClient } from '@orion/board-jira';
import { createTrelloClient } from '@orion/board-trello';
import { createGithubClient } from '@orion/board-github';
import type {
  BoardRegistry,
  RemoteBoardClient,
  RemoteBoardClientFactory,
  RemoteConnectionConfig,
  RemoteContainer,
  RemoteState,
} from '@orion/board-core';
import type {
  BoardConnectionRepository,
  EpicRepository,
  LabelRepository,
  ProjectRepository,
  TicketRepository,
} from '@orion/db';
import type {
  BoardConnection,
  BoardSyncLog,
  BoardSyncTrigger,
  CreateTicketInput,
  MoveTriggerResult,
  TicketSource,
  UpdateTicketInput,
  UpsertBoardConnectionInput,
} from '@orion/models';
import type { RunEventBus } from '../event-bus.js';
import type { RemoteIssue } from '@orion/board-core';

export interface SyncSummary {
  imported: number;
  updated: number;
  epicsLinked: number;
}

type SyncIssue = RemoteIssue;

/** Just enough of {@link SecretCipher} for the sync service to encrypt secrets. */
export interface SecretCipherLike {
  encrypt(plaintext: string): string;
  decrypt(value: string): string;
}

const passthroughCipher: SecretCipherLike = {
  encrypt: (s) => s,
  decrypt: (s) => s,
};

const DEFAULT_LABEL_COLOR = '#6366f1';
const DEFAULT_EPIC_COLOR = '#7c3aed';

/** Built-in provider factories, keyed by connection `provider`. */
export const DEFAULT_BOARD_CLIENT_FACTORIES: Record<string, RemoteBoardClientFactory> = {
  linear: createLinearClient,
  jira: createJiraClient,
  trello: createTrelloClient,
  github: createGithubClient,
};

/**
 * Reconciles external task boards (Linear, Jira, Trello, ...) with Orion's
 * native board. The provider is chosen per connection, secrets are encrypted at
 * rest, and the `direction` / control flags decide which side of the sync runs.
 */
export class BoardSyncService {
  private readonly factories: Record<string, RemoteBoardClientFactory>;
  private onSwimlaneEnter: ((ticketId: string, destSwimlane: string) => Promise<MoveTriggerResult>) | null = null;

  constructor(
    private readonly boardConnections: BoardConnectionRepository,
    private readonly tickets: TicketRepository,
    private readonly projects: ProjectRepository,
    private readonly labels: LabelRepository,
    private readonly epics: EpicRepository,
    private readonly boards: BoardRegistry,
    private readonly bus: RunEventBus,
    private readonly cipher: SecretCipherLike = passthroughCipher,
    factories: Record<string, RemoteBoardClientFactory> = DEFAULT_BOARD_CLIENT_FACTORIES,
  ) {
    this.factories = factories;
  }

  /**
   * Register a callback that fires whenever a sync pull results in a ticket
   * entering a swimlane (existing ticket with changed swimlane).
   * The callback is responsible for evaluating whether to auto-start/retry a
   * workflow run. Errors are silently caught.
   */
  setOnTicketEnteredSwimlane(
    handler: (ticketId: string, destSwimlane: string) => Promise<MoveTriggerResult>,
  ): void {
    this.onSwimlaneEnter = handler;
  }

  private factory(provider: string): RemoteBoardClientFactory {
    const factory = this.factories[provider];
    if (!factory) {
      throw new Error(
        `Unsupported board provider '${provider}'. Available: ${Object.keys(this.factories).join(', ')}`,
      );
    }
    return factory;
  }

  private buildClient(config: RemoteConnectionConfig): RemoteBoardClient {
    return this.factory(config.provider)(config);
  }

  /** Build a client for a stored connection, decrypting its secret. */
  private clientFor(conn: BoardConnection): RemoteBoardClient {
    return this.buildClient({
      provider: conn.provider,
      apiKey: this.cipher.decrypt(conn.apiKey),
      containerId: conn.teamId,
      config: conn.config,
    });
  }

  async getConnection(projectId: string): Promise<BoardConnection | null> {
    return this.boardConnections.getByProject(projectId);
  }

  async upsertConnection(
    projectId: string,
    input: UpsertBoardConnectionInput,
  ): Promise<BoardConnection> {
    const existing = await this.getConnection(projectId);
    const provider = input.provider ?? existing?.provider ?? 'linear';
    const config = { ...(existing?.config ?? {}), ...(input.config ?? {}) };
    const containerId = input.teamId ?? existing?.teamId ?? '';

    // Validate credentials only when a fresh secret is supplied.
    if (input.apiKey) {
      const client = this.buildClient({ provider, apiKey: input.apiKey, containerId, config });
      await client.listContainers();
      if (containerId) await client.listStates(containerId);
    }

    const toStore: UpsertBoardConnectionInput = { ...input, provider };
    if (input.apiKey) toStore.apiKey = this.cipher.encrypt(input.apiKey);
    return this.boardConnections.upsert(projectId, toStore);
  }

  async disconnect(projectId: string): Promise<void> {
    await this.boardConnections.delete(projectId);
  }

  /**
   * List the remote containers (teams/projects/boards) reachable for a project.
   * A plaintext `apiKey`/`provider`/`config` override is used when supplied
   * (e.g. while first configuring); otherwise the stored connection is used.
   */
  async listContainers(
    projectId: string,
    override: { provider?: string; apiKey?: string; config?: Record<string, string> } = {},
  ): Promise<RemoteContainer[]> {
    const client = await this.resolveProbe(projectId, override);
    return client.listContainers();
  }

  async listStates(
    projectId: string,
    containerId: string,
    override: { provider?: string; apiKey?: string; config?: Record<string, string> } = {},
  ): Promise<RemoteState[]> {
    const client = await this.resolveProbe(projectId, override);
    return client.listStates(containerId);
  }

  /** Resolve a client from stored connection merged with plaintext overrides. */
  private async resolveProbe(
    projectId: string,
    override: { provider?: string; apiKey?: string; config?: Record<string, string> },
  ): Promise<RemoteBoardClient> {
    const conn = await this.getConnection(projectId);
    const provider = override.provider ?? conn?.provider ?? 'linear';
    const apiKey = override.apiKey ?? (conn ? this.cipher.decrypt(conn.apiKey) : '');
    const config = { ...(conn?.config ?? {}), ...(override.config ?? {}) };
    if (!apiKey) throw new Error('apiKey is required');
    return this.buildClient({ provider, apiKey, containerId: conn?.teamId ?? '', config });
  }

  async syncNow(projectId: string, trigger: BoardSyncTrigger = 'auto'): Promise<SyncSummary> {
    const conn = await this.getConnection(projectId);
    if (!conn || !conn.apiKey || !conn.enabled) {
      throw new Error('No active board connection for this project');
    }

    const startedAt = new Date();

    // Push-only connections never import from the remote board.
    if (conn.direction === 'push') {
      await this.boardConnections.touchSynced(projectId, new Date());
      return { imported: 0, updated: 0, epicsLinked: 0 };
    }

    const client = this.clientFor(conn);
    let imported = 0;
    let updated = 0;
    let epicsLinked = 0;
    const linkedEpics = new Set<string>();

    try {
      const [project, issues] = await Promise.all([
        this.projects.get(projectId),
        client.listIssues(conn.teamId),
      ]);
      if (!project) throw new Error('Project not found');

      const boardSwimlanes = (
        await this.boards.get(project.boardProvider).getBoard(project.id, [])
      ).swimlanes;
      const validColumnKeys = new Set(boardSwimlanes.map((c) => c.key));
      const firstSwimlane = boardSwimlanes[0]?.key ?? 'backlog';

      // stateMap is authored swimlane -> remoteStateId; invert it for the pull.
      const stateToSwimlane: Record<string, string> = {};
      for (const [swimlane, stateId] of Object.entries(conn.stateMap)) {
        if (stateId) stateToSwimlane[stateId] = swimlane;
      }

      const source = conn.provider as TicketSource;

      const triggered: Array<{ ticketId: string; swimlane: string }> = [];

      for (const issue of issues) {
        const swimlane =
          stateToSwimlane[issue.stateId] ??
          findColumnByStateName(issue.stateName, validColumnKeys) ??
          firstSwimlane;

        const existing = await this.tickets.getByExternal(projectId, source, issue.id);

        if (existing) {
          if (!conn.updateExisting) continue;

          const updateInput = await this.buildTicketUpdate(existing, issue, swimlane, projectId, linkedEpics);

          if (updateInput) {
            await this.tickets.update(existing.id, updateInput);
            updated++;
            if (existing.swimlane !== swimlane) {
              triggered.push({ ticketId: existing.id, swimlane });
            }
          }
        } else if (conn.importNew) {
          const createInput = await this.buildTicketCreate(issue, swimlane, source, projectId, linkedEpics);
          await this.tickets.create(createInput);
          imported++;
        }
      }

      epicsLinked = linkedEpics.size;
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      const logInput: Pick<BoardSyncLog, 'projectId' | 'startedAt' | 'finishedAt' | 'status' | 'imported' | 'updated' | 'epicsLinked' | 'error' | 'durationMs' | 'trigger'> = {
        projectId,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        status: 'completed',
        imported,
        updated,
        epicsLinked,
        error: null,
        durationMs,
        trigger,
      };

      try {
        await this.boardConnections.insertSyncLog(logInput);
      } catch (err) {
        console.error('[ board-sync ] Failed to persist sync log:', err);
      }

      await this.boardConnections.touchSynced(projectId, finishedAt);

      // Fire auto-trigger for every ticket that entered a swimlane during this pull.
      for (const t of triggered) {
        if (this.onSwimlaneEnter) {
          this.onSwimlaneEnter(t.ticketId, t.swimlane).catch(() => undefined);
        }
      }

      this.bus.emit(`board:${projectId}`, {
        type: 'sync.completed',
        projectId,
        imported,
        updated,
        epicsLinked,
        durationMs,
        at: finishedAt.toISOString(),
      });

      return { imported, updated, epicsLinked };
    } catch (err) {
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      const message = err instanceof Error ? err.message : String(err);

      try {
        await this.boardConnections.insertSyncLog({
          projectId,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          status: 'failed',
          imported,
          updated,
          epicsLinked: linkedEpics.size,
          error: message,
          durationMs,
          trigger,
        });
      } catch (logErr) {
        console.error('[ board-sync ] Failed to persist failed-sync log:', logErr);
      }

      this.bus.emit(`board:${projectId}`, {
        type: 'sync.failed',
        projectId,
        imported,
        updated,
        epicsLinked: linkedEpics.size,
        error: message,
        durationMs,
        at: finishedAt.toISOString(),
      });

      throw err;
    }
  }

  /** Resolve (or create) a label by name. Returns its id. */
  private async resolveLabel(
    projectId: string,
    remoteLabel: { name: string; color?: string },
  ): Promise<string> {
    const existing = await this.labels.getByName(projectId, remoteLabel.name);
    if (existing) return existing.id;
    const created = await this.labels.create({
      projectId,
      name: remoteLabel.name,
      color: remoteLabel.color ?? DEFAULT_LABEL_COLOR,
    });
    return created.id;
  }

  /** Resolve (or create) an epic by externalId. Returns its id or undefined. */
  private async resolveEpic(
    projectId: string,
    remoteEpic: { id: string; name: string; color?: string },
    linkedEpics: Set<string>,
  ): Promise<string | undefined> {
    if (!remoteEpic.id || !remoteEpic.name) return undefined;
    const existing = await this.epics.getByExternal(projectId, remoteEpic.id);
    if (existing) {
      linkedEpics.add(existing.id);
      return existing.id;
    }
    const created = await this.epics.create({
      projectId,
      title: remoteEpic.name,
      color: isValidHex(remoteEpic.color) ? remoteEpic.color : DEFAULT_EPIC_COLOR,
      externalId: remoteEpic.id,
    });
    linkedEpics.add(created.id);
    return created.id;
  }

  /** Build input for creating a ticket from a remote issue. */
  private async buildTicketCreate(
    issue: SyncIssue,
    swimlane: string,
    source: TicketSource,
    projectId: string,
    linkedEpics: Set<string>,
  ): Promise<CreateTicketInput & { swimlane: string }> {
    const input: CreateTicketInput & { swimlane: string } = {
      projectId,
      title: issue.title,
      description: issue.description,
      swimlane,
      source,
      externalId: issue.id,
    };

    if (issue.priority !== undefined) input.priority = clampPriority(issue.priority) as CreateTicketInput['priority'];
    if (issue.dueDate) input.dueDate = issue.dueDate;
    if (issue.startedAt) input.startDate = issue.startedAt.split('T')[0];

    if (issue.labels) {
      input.labelIds = await Promise.all(
        issue.labels.map((l) => this.resolveLabel(projectId, l)),
      );
    }

    if (issue.epic) {
      input.epicId = await this.resolveEpic(projectId, issue.epic, linkedEpics);
    }

    return input;
  }

  /** Build input for updating an existing ticket with remote changes. Returns null if nothing changed. */
  private async buildTicketUpdate(
    existing: { swimlane: string; title: string; description: string; priority: number; dueDate?: string; startDate?: string; labelIds: string[]; epicId?: string },
    issue: SyncIssue,
    swimlane: string,
    projectId: string,
    linkedEpics: Set<string>,
  ): Promise<UpdateTicketInput | null> {
    const input: UpdateTicketInput = {};

    if (existing.title !== issue.title) input.title = issue.title;
    if (existing.description !== issue.description) input.description = issue.description;
    if (existing.swimlane !== swimlane) input.swimlane = swimlane;

    if (issue.priority !== undefined) {
      const prio = clampPriority(issue.priority) as UpdateTicketInput['priority'];
      if (existing.priority !== prio) input.priority = prio;
    }

    if (issue.dueDate !== undefined) {
      if (existing.dueDate !== issue.dueDate) input.dueDate = issue.dueDate;
    }

    if (issue.startedAt !== undefined) {
      const startDate = issue.startedAt.split('T')[0];
      if (existing.startDate !== startDate) input.startDate = startDate;
    }

    // Label resolution
    if (issue.labels !== undefined) {
      const labelIds = await Promise.all(
        issue.labels.map((l) => this.resolveLabel(projectId, l)),
      );
      const existingSet = new Set(existing.labelIds ?? []);
      const newSet = new Set(labelIds);
      if (
        existingSet.size !== newSet.size ||
        ![...existingSet].every((id) => newSet.has(id))
      ) {
        input.labelIds = labelIds;
      }
    }

    // Epic resolution
    if (issue.epic !== undefined) {
      const epicId = await this.resolveEpic(projectId, issue.epic, linkedEpics);
      if (existing.epicId !== epicId) {
        input.epicId = epicId ?? null;
      }
    }

    if (Object.keys(input).length === 0) return null;
    return input;
  }

  /**
   * Post a comment onto a ticket's upstream issue. Best-effort and a no-op
   * (`{ posted: false }`) when the ticket is local or the project has no active
   * connection.
   */
  async postComment(
    ticketId: string,
    body: string,
  ): Promise<{ posted: boolean; target?: string }> {
    const ticket = await this.tickets.get(ticketId);
    if (!ticket || ticket.source === 'native' || !ticket.externalId) {
      return { posted: false };
    }
    const conn = await this.getConnection(ticket.projectId);
    if (!conn || !conn.apiKey || !conn.enabled) {
      return { posted: false };
    }
    await this.clientFor(conn).createComment(ticket.externalId, body);
    return { posted: true, target: `${conn.provider}:${ticket.externalId}` };
  }

  /** Push a ticket's swimlane change to the remote board (on-move). */
  async pushTicketState(ticketId: string): Promise<void> {
    try {
      const ticket = await this.tickets.get(ticketId);
      if (!ticket || ticket.source === 'native' || !ticket.externalId) return;

      const conn = await this.getConnection(ticket.projectId);
      if (!conn || !conn.apiKey || !conn.enabled) return;
      if (conn.direction === 'pull' || !conn.autoPush) return;

      const remoteStateId = conn.stateMap[ticket.swimlane];
      if (!remoteStateId) return;

      await this.clientFor(conn).updateIssueState(ticket.externalId, remoteStateId);
    } catch (err) {
      console.error(
        `[ board-sync ] pushTicketState failed for ticket ${ticketId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Get the latest sync log for a project. */
  async getLatestSyncLog(projectId: string): Promise<BoardSyncLog | null> {
    return this.boardConnections.getLatestSyncLog(projectId);
  }

  /** Get sync log history for a project (newest first). */
  async getSyncLogs(projectId: string, limit: number): Promise<BoardSyncLog[]> {
    return this.boardConnections.getSyncLogs(projectId, limit);
  }
}

function clampPriority(p: number): number {
  if (p < 0) return 0;
  if (p > 4) return 4;
  return Math.floor(p);
}

function isValidHex(color: string | undefined): boolean {
  if (!color) return false;
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

/** Best-effort fuzzy match of a remote state name to a local swimlane key. */
function findColumnByStateName(
  stateName: string,
  validColumns: Set<string>,
): string | undefined {
  const lower = stateName.toLowerCase().replace(/\s+/g, '_');
  if (validColumns.has(lower)) return lower;

  for (const key of validColumns) {
    if (key.toLowerCase().replace(/_/g, ' ') === stateName.toLowerCase()) return key;
  }
  for (const key of validColumns) {
    if (key === stateName) return key;
  }
  return undefined;
}
