import { LinearBoardClient, type LinearClientLike } from '@orion/board-linear';
import type { BoardRegistry } from '@orion/board-core';
import type { BoardConnectionRepository, ProjectRepository, TicketRepository } from '@orion/db';
import type { BoardConnection, UpsertBoardConnectionInput } from '@orion/models';

export interface SyncSummary {
  imported: number;
  updated: number;
}

export type LinearClientFactory = (apiKey: string) => LinearClientLike;

export class LinearSyncService {
  private readonly createClient: LinearClientFactory;

  constructor(
    private readonly boardConnections: BoardConnectionRepository,
    private readonly tickets: TicketRepository,
    private readonly projects: ProjectRepository,
    private readonly boards: BoardRegistry,
    clientFactory?: LinearClientFactory,
  ) {
    this.createClient = clientFactory ?? ((apiKey) => new LinearBoardClient(apiKey));
  }

  private client(apiKey: string): LinearClientLike {
    return this.createClient(apiKey);
  }

  async getConnection(projectId: string): Promise<BoardConnection | null> {
    return this.boardConnections.getByProject(projectId);
  }

  async upsertConnection(
    projectId: string,
    input: UpsertBoardConnectionInput & { apiKey?: string },
  ): Promise<BoardConnection> {
    if (input.apiKey) {
      await this.client(input.apiKey).listTeams();
      if (input.teamId) {
        await this.client(input.apiKey).listWorkflowStates(input.teamId);
      }
    }
    return this.boardConnections.upsert(projectId, input);
  }

  async disconnect(projectId: string): Promise<void> {
    await this.boardConnections.delete(projectId);
  }

  async listTeams(apiKey: string) {
    return this.client(apiKey).listTeams();
  }

  async listStates(apiKey: string, teamId: string) {
    return this.client(apiKey).listWorkflowStates(teamId);
  }

  async syncNow(projectId: string): Promise<SyncSummary> {
    const conn = await this.getConnection(projectId);
    if (!conn || !conn.apiKey || !conn.enabled) {
      throw new Error('No active Linear connection for this project');
    }

    const [project, issues, states] = await Promise.all([
      this.projects.get(projectId),
      this.client(conn.apiKey).listIssues(conn.teamId),
      this.client(conn.apiKey).listWorkflowStates(conn.teamId),
    ]);

    if (!project) throw new Error('Project not found');

    const stateNameToId = new Map(states.map((s) => [s.name, s.id]));

    const boardSwimlanes = (
      await this.boards.get(project.boardProvider).getBoard(project.id, [])
    ).swimlanes;
    const validColumnKeys = new Set(boardSwimlanes.map((c) => c.key));
    const firstSwimlane = boardSwimlanes[0]?.key ?? 'backlog';

    let imported = 0;
    let updated = 0;

    for (const issue of issues) {
      let swimlane: string | undefined = conn.stateMap[issue.stateId];
      if (!swimlane) {
        swimlane = findColumnByStateName(
          issue.stateName,
          stateNameToId,
          validColumnKeys,
        );
      }
      swimlane = swimlane || firstSwimlane;

      const existing = await this.tickets.getByExternal(
        projectId,
        'linear',
        issue.id,
      );

      if (existing) {
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
      } else {
        await this.tickets.create({
          projectId,
          title: issue.title,
          description: issue.description,
          swimlane,
          source: 'linear',
          externalId: issue.id,
        });
        imported++;
      }
    }

    await this.boardConnections.touchSynced(projectId, new Date());
    return { imported, updated };
  }

  /**
   * Post a comment onto a ticket's upstream Linear issue. Best-effort and a
   * no-op (returns `{ posted: false }`) when the ticket is local or the project
   * has no active Linear connection.
   */
  async postComment(ticketId: string, body: string): Promise<{ posted: boolean; target?: string }> {
    const ticket = await this.tickets.get(ticketId);
    if (!ticket || ticket.source !== 'linear' || !ticket.externalId) {
      return { posted: false };
    }
    const conn = await this.getConnection(ticket.projectId);
    if (!conn || !conn.apiKey || !conn.enabled) {
      return { posted: false };
    }
    await this.client(conn.apiKey).createComment(ticket.externalId, body);
    return { posted: true, target: `linear:${ticket.externalId}` };
  }

  async pushTicketState(ticketId: string): Promise<void> {
    try {
      const ticket = await this.tickets.get(ticketId);
      if (!ticket || ticket.source !== 'linear' || !ticket.externalId) return;

      const conn = await this.getConnection(ticket.projectId);
      if (!conn || !conn.apiKey || !conn.enabled) return;

      const linearStateId = conn.stateMap[ticket.swimlane];
      if (!linearStateId) return;

      await this.client(conn.apiKey).updateIssueState(
        ticket.externalId,
        linearStateId,
      );
    } catch (err) {
      console.error(
        `[ linear-sync ] pushTicketState failed for ticket ${ticketId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

function findColumnByStateName(
  stateName: string,
  stateNameToId: Map<string, string>,
  validColumns: Set<string>,
): string | undefined {
  const linearId = stateNameToId.get(stateName);
  if (linearId && validColumns.has(linearId)) return linearId;

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
