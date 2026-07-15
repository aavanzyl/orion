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
import type { BoardConnectionRepository, ProjectRepository, TicketRepository } from '@orion/db';
import type {
  BoardConnection,
  TicketSource,
  UpsertBoardConnectionInput,
} from '@orion/models';

export interface SyncSummary {
  imported: number;
  updated: number;
}

/** Just enough of {@link SecretCipher} for the sync service to encrypt secrets. */
export interface SecretCipherLike {
  encrypt(plaintext: string): string;
  decrypt(value: string): string;
}

const passthroughCipher: SecretCipherLike = {
  encrypt: (s) => s,
  decrypt: (s) => s,
};

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

  constructor(
    private readonly boardConnections: BoardConnectionRepository,
    private readonly tickets: TicketRepository,
    private readonly projects: ProjectRepository,
    private readonly boards: BoardRegistry,
    private readonly cipher: SecretCipherLike = passthroughCipher,
    factories: Record<string, RemoteBoardClientFactory> = DEFAULT_BOARD_CLIENT_FACTORIES,
  ) {
    this.factories = factories;
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

  async syncNow(projectId: string): Promise<SyncSummary> {
    const conn = await this.getConnection(projectId);
    if (!conn || !conn.apiKey || !conn.enabled) {
      throw new Error('No active board connection for this project');
    }

    // Push-only connections never import from the remote board.
    if (conn.direction === 'push') {
      await this.boardConnections.touchSynced(projectId, new Date());
      return { imported: 0, updated: 0 };
    }

    const client = this.clientFor(conn);
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
    let imported = 0;
    let updated = 0;

    for (const issue of issues) {
      const swimlane =
        stateToSwimlane[issue.stateId] ??
        findColumnByStateName(issue.stateName, validColumnKeys) ??
        firstSwimlane;

      const existing = await this.tickets.getByExternal(projectId, source, issue.id);

      if (existing) {
        if (!conn.updateExisting) continue;
        const needsUpdate =
          existing.title !== issue.title ||
          existing.description !== issue.description ||
          existing.swimlane !== swimlane;
        if (needsUpdate) {
          await this.tickets.update(existing.id, {
            title: issue.title,
            description: issue.description,
            swimlane,
          });
          updated++;
        }
      } else if (conn.importNew) {
        await this.tickets.create({
          projectId,
          title: issue.title,
          description: issue.description,
          swimlane,
          source,
          externalId: issue.id,
        });
        imported++;
      }
    }

    await this.boardConnections.touchSynced(projectId, new Date());
    return { imported, updated };
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
