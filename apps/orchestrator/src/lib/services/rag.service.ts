import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodeIndex, Project, ProjectId, SearchResult } from '@orion/models';
import {
  chunkFile,
  type CodeChunkInput,
  type EmbeddingProvider,
  LocalEmbeddingProvider,
  OpenAiEmbeddingProvider,
  rankBySimilarity,
  walkRepo,
} from '@orion/rag';
import type { InsertCodeChunkInput } from '@orion/db';
import type { Container } from '../container.js';
import { WorkspaceService } from './workspace.service.js';

/** Texts embedded per provider call while indexing. */
const EMBED_BATCH = 128;

/**
 * Indexes a project's repository into embeddings and answers similarity search
 * queries. Embeddings are stored as JSON `number[]` and ranked with cosine
 * similarity in JS, so this works identically on Postgres and PGlite (no
 * pgvector). One env-derived embedding provider is used for both indexing and
 * search so the vector space stays consistent.
 */
export class RagService {
  private readonly workspaces: WorkspaceService;
  private readonly provider: EmbeddingProvider;

  constructor(private readonly c: Container) {
    this.workspaces = new WorkspaceService(c);
    this.provider = this.resolveProvider();
  }

  /** Choose the embedding provider from env: OpenAI-compatible if configured, else local. */
  private resolveProvider(): EmbeddingProvider {
    const { codexApiKey, codexBaseUrl } = this.c.env;
    if (codexApiKey && codexBaseUrl) {
      return new OpenAiEmbeddingProvider({ apiKey: codexApiKey, baseUrl: codexBaseUrl });
    }
    return new LocalEmbeddingProvider();
  }

  /** The current index status, or a default `idle` status when never indexed. */
  async getStatus(projectId: ProjectId): Promise<CodeIndex> {
    const index = await this.c.rag.getIndex(projectId);
    return index ?? this.defaultStatus(projectId);
  }

  private defaultStatus(projectId: ProjectId): CodeIndex {
    const now = new Date().toISOString();
    return {
      id: '',
      projectId,
      status: 'idle',
      provider: this.provider.id,
      dimensions: this.provider.dimensions,
      fileCount: 0,
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Kick off a (re)index of the project's repository. Returns immediately with
   * status `indexing`; the heavy work runs in the background and updates the
   * status row to `ready` (or `error`) when finished.
   */
  async reindex(projectId: ProjectId): Promise<CodeIndex> {
    const project = await this.c.projects.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const status = await this.c.rag.upsertIndex(projectId, {
      status: 'indexing',
      provider: this.provider.id,
      dimensions: this.provider.dimensions,
      error: null,
    });

    void this.runIndex(project).catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      await this.c.rag
        .upsertIndex(projectId, { status: 'error', error: message })
        .catch(() => undefined);
    });

    return status;
  }

  private async runIndex(project: Project): Promise<void> {
    const root = await this.workspaces.resolveConfigRoot(project);
    const files = await walkRepo(root);

    const chunks: CodeChunkInput[] = [];
    for (const filePath of files) {
      let content: string;
      try {
        content = await readFile(join(root, filePath), 'utf8');
      } catch {
        continue;
      }
      chunks.push(...chunkFile(filePath, content));
    }

    const rows: InsertCodeChunkInput[] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await this.provider.embed(batch.map((chunk) => chunk.content));
      batch.forEach((chunk, j) => {
        rows.push({
          projectId: project.id,
          filePath: chunk.filePath,
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          embedding: vectors[j] ?? [],
        });
      });
    }

    await this.c.rag.clearChunks(project.id);
    await this.c.rag.insertChunks(rows);

    await this.c.rag.upsertIndex(project.id, {
      status: 'ready',
      provider: this.provider.id,
      dimensions: this.provider.dimensions,
      fileCount: files.length,
      chunkCount: rows.length,
      error: null,
      lastIndexedAt: new Date(),
    });
  }

  /**
   * Return the top-K chunks most similar to `query`. Returns `[]` when the
   * project has not been indexed yet.
   */
  async search(projectId: ProjectId, query: string, topK = 8): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const index = await this.c.rag.getIndex(projectId);
    if (!index || index.status !== 'ready') return [];

    const chunks = await this.c.rag.listChunks(projectId);
    if (chunks.length === 0) return [];

    const [queryVec] = await this.provider.embed([trimmed]);
    return rankBySimilarity(queryVec, chunks, topK).map(({ item, score }) => ({
      filePath: item.filePath,
      startLine: item.startLine,
      endLine: item.endLine,
      snippet: item.content,
      score,
    }));
  }
}
