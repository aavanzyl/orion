import { eq } from 'drizzle-orm';
import type { CodeIndex, IndexStatus, ProjectId } from '@orion/models';
import type { Database } from '../client.js';
import { codeChunks, codeIndexes } from '../schema.js';
import { toCodeIndex } from '../mappers.js';

/** A chunk row ready to persist (project-scoped). */
export interface InsertCodeChunkInput {
  projectId: ProjectId;
  filePath: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
  embedding: number[];
}

/** Lightweight chunk projection used for in-memory similarity ranking. */
export interface ChunkVector {
  id: string;
  filePath: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
  embedding: number[];
}

/** Mutable fields of a code index; `error`/`lastIndexedAt` may be cleared with `null`. */
export interface CodeIndexPatch {
  status?: IndexStatus;
  provider?: string;
  dimensions?: number;
  fileCount?: number;
  chunkCount?: number;
  error?: string | null;
  lastIndexedAt?: Date | null;
}

const CHUNK_INSERT_BATCH = 500;

export class RagRepository {
  constructor(private readonly db: Database) {}

  async getIndex(projectId: ProjectId): Promise<CodeIndex | null> {
    const [row] = await this.db.select().from(codeIndexes).where(eq(codeIndexes.projectId, projectId));
    return row ? toCodeIndex(row) : null;
  }

  /** Create or update the project's index status row, returning the current row. */
  async upsertIndex(projectId: ProjectId, patch: CodeIndexPatch): Promise<CodeIndex> {
    const existing = await this.getIndex(projectId);
    if (existing) {
      const values: Partial<typeof codeIndexes.$inferInsert> = { updatedAt: new Date() };
      if (patch.status !== undefined) values.status = patch.status;
      if (patch.provider !== undefined) values.provider = patch.provider;
      if (patch.dimensions !== undefined) values.dimensions = patch.dimensions;
      if (patch.fileCount !== undefined) values.fileCount = patch.fileCount;
      if (patch.chunkCount !== undefined) values.chunkCount = patch.chunkCount;
      if (patch.error !== undefined) values.error = patch.error;
      if (patch.lastIndexedAt !== undefined) values.lastIndexedAt = patch.lastIndexedAt;
      const [row] = await this.db
        .update(codeIndexes)
        .set(values)
        .where(eq(codeIndexes.projectId, projectId))
        .returning();
      return toCodeIndex(row);
    }

    const [row] = await this.db
      .insert(codeIndexes)
      .values({
        projectId,
        status: patch.status ?? 'idle',
        provider: patch.provider ?? '',
        dimensions: patch.dimensions ?? 0,
        fileCount: patch.fileCount ?? 0,
        chunkCount: patch.chunkCount ?? 0,
        error: patch.error ?? null,
        lastIndexedAt: patch.lastIndexedAt ?? null,
      })
      .returning();
    return toCodeIndex(row);
  }

  async clearChunks(projectId: ProjectId): Promise<void> {
    await this.db.delete(codeChunks).where(eq(codeChunks.projectId, projectId));
  }

  /** Batch-insert chunk rows (chunked to stay within parameter limits). */
  async insertChunks(rows: InsertCodeChunkInput[]): Promise<void> {
    for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH) {
      const batch = rows.slice(i, i + CHUNK_INSERT_BATCH);
      if (batch.length === 0) continue;
      await this.db.insert(codeChunks).values(batch);
    }
  }

  async listChunks(projectId: ProjectId): Promise<ChunkVector[]> {
    return this.db
      .select({
        id: codeChunks.id,
        filePath: codeChunks.filePath,
        chunkIndex: codeChunks.chunkIndex,
        startLine: codeChunks.startLine,
        endLine: codeChunks.endLine,
        content: codeChunks.content,
        embedding: codeChunks.embedding,
      })
      .from(codeChunks)
      .where(eq(codeChunks.projectId, projectId));
  }
}
