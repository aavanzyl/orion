import type { ProjectId } from './project.model.js';

/** Lifecycle state of a project's codebase index. */
export type IndexStatus = 'idle' | 'indexing' | 'ready' | 'error';

/** A single embedded chunk of a source file stored in the vector store. */
export interface CodeChunk {
  id: string;
  projectId: ProjectId;
  filePath: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
  /** Embedding vector stored as JSON; cosine similarity is computed in JS. */
  embedding: number[];
  createdAt: string;
}

/** Status + metadata of a project's codebase index. */
export interface CodeIndex {
  id: string;
  projectId: ProjectId;
  status: IndexStatus;
  /** Embedding provider id used for this index, e.g. `local`. */
  provider: string;
  /** Embedding dimensionality; search must use the same space. */
  dimensions: number;
  fileCount: number;
  chunkCount: number;
  error?: string;
  lastIndexedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A ranked codebase search hit returned to callers. */
export interface SearchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
}
