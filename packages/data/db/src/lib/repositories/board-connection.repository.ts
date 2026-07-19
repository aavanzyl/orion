import { desc, eq, inArray } from 'drizzle-orm';
import type { BoardConnection, BoardSyncLog, ProjectId, UpsertBoardConnectionInput } from '@orion/models';
import type { Database } from '../client.js';
import { boardConnections, boardSyncLogs } from '../schema.js';
import { toBoardConnection, toBoardSyncLog } from '../mappers.js';

const MAX_LOGS_PER_PROJECT = 50;

export class BoardConnectionRepository {
  constructor(private readonly db: Database) {}

  async getByProject(projectId: ProjectId): Promise<BoardConnection | null> {
    const [row] = await this.db
      .select()
      .from(boardConnections)
      .where(eq(boardConnections.projectId, projectId));
    return row ? toBoardConnection(row) : null;
  }

  /** Every enabled board connection across all projects. */
  async listEnabled(): Promise<BoardConnection[]> {
    const rows = await this.db
      .select()
      .from(boardConnections)
      .where(eq(boardConnections.enabled, true));
    return rows.map(toBoardConnection);
  }

  async upsert(
    projectId: ProjectId,
    input: UpsertBoardConnectionInput,
  ): Promise<BoardConnection> {
    const existing = await this.getByProject(projectId);

    if (existing) {
      const values: Partial<typeof boardConnections.$inferInsert> = { updatedAt: new Date() };
      if (input.provider !== undefined) values.provider = input.provider;
      if (input.apiKey !== undefined) values.apiKey = input.apiKey;
      if (input.teamId !== undefined) values.teamId = input.teamId;
      if (input.config !== undefined) values.config = input.config;
      if (input.stateMap !== undefined) values.stateMap = input.stateMap;
      if (input.direction !== undefined) values.direction = input.direction;
      if (input.autoPush !== undefined) values.autoPush = input.autoPush;
      if (input.importNew !== undefined) values.importNew = input.importNew;
      if (input.updateExisting !== undefined) values.updateExisting = input.updateExisting;
      if (input.syncIntervalMs !== undefined)
        values.syncIntervalMs = input.syncIntervalMs ?? null;
      if (input.enabled !== undefined) values.enabled = input.enabled;

      const [row] = await this.db
        .update(boardConnections)
        .set(values)
        .where(eq(boardConnections.projectId, projectId))
        .returning();
      return toBoardConnection(row);
    }

    const [row] = await this.db
      .insert(boardConnections)
      .values({
        projectId,
        provider: input.provider ?? 'linear',
        apiKey: input.apiKey ?? '',
        teamId: input.teamId ?? '',
        config: input.config ?? {},
        stateMap: input.stateMap ?? {},
        direction: input.direction ?? 'both',
        autoPush: input.autoPush ?? true,
        importNew: input.importNew ?? true,
        updateExisting: input.updateExisting ?? true,
        syncIntervalMs: input.syncIntervalMs ?? null,
        enabled: input.enabled ?? true,
      })
      .returning();
    return toBoardConnection(row);
  }

  async delete(projectId: ProjectId): Promise<void> {
    await this.db
      .delete(boardConnections)
      .where(eq(boardConnections.projectId, projectId));
  }

  async touchSynced(projectId: ProjectId, date: Date): Promise<void> {
    await this.db
      .update(boardConnections)
      .set({ lastSyncedAt: date, updatedAt: new Date() })
      .where(eq(boardConnections.projectId, projectId));
  }

  // --- Sync logs ---

  async insertSyncLog(
    log: Pick<BoardSyncLog, 'projectId' | 'startedAt' | 'finishedAt' | 'status' | 'imported' | 'updated' | 'epicsLinked' | 'error' | 'durationMs' | 'trigger'>,
  ): Promise<BoardSyncLog> {
    const [row] = await this.db
      .insert(boardSyncLogs)
      .values({
        projectId: log.projectId,
        startedAt: new Date(log.startedAt),
        finishedAt: new Date(log.finishedAt),
        status: log.status,
        imported: log.imported,
        updated: log.updated,
        epicsLinked: log.epicsLinked,
        error: log.error,
        durationMs: log.durationMs,
        trigger: log.trigger,
      })
      .returning();

    await this.pruneSyncLogs(log.projectId);

    return toBoardSyncLog(row);
  }

  async getSyncLogs(projectId: ProjectId, limit: number): Promise<BoardSyncLog[]> {
    const rows = await this.db
      .select()
      .from(boardSyncLogs)
      .where(eq(boardSyncLogs.projectId, projectId))
      .orderBy(desc(boardSyncLogs.startedAt))
      .limit(limit);
    return rows.map(toBoardSyncLog);
  }

  async getLatestSyncLog(projectId: ProjectId): Promise<BoardSyncLog | null> {
    const [row] = await this.db
      .select()
      .from(boardSyncLogs)
      .where(eq(boardSyncLogs.projectId, projectId))
      .orderBy(desc(boardSyncLogs.startedAt))
      .limit(1);
    return row ? toBoardSyncLog(row) : null;
  }

  private async pruneSyncLogs(projectId: ProjectId): Promise<void> {
    const existing = await this.getSyncLogs(projectId, 2000);
    if (existing.length <= MAX_LOGS_PER_PROJECT) return;

    const idsToDelete = existing.slice(MAX_LOGS_PER_PROJECT).map((l) => l.id);
    if (idsToDelete.length === 0) return;

    await this.db
      .delete(boardSyncLogs)
      .where(inArray(boardSyncLogs.id, idsToDelete));
  }
}
