/**
 * Shared value types for the RAG (retrieval-augmented generation) pipeline.
 * The package is intentionally dependency-free: it deals in plain arrays and
 * records so it works identically in Node, tests and the orchestrator.
 */

/** A single chunk of a source file, produced by {@link chunkFile}. */
export interface CodeChunkInput {
  /** Repo-relative path of the source file. */
  filePath: string;
  /** Zero-based index of this chunk within the file. */
  chunkIndex: number;
  /** One-based first line covered by this chunk. */
  startLine: number;
  /** One-based last line covered by this chunk. */
  endLine: number;
  /** Raw text content of the chunk. */
  content: string;
}

/** A chunk paired with its embedding vector, ready for similarity ranking. */
export interface EmbeddedChunk extends CodeChunkInput {
  embedding: number[];
}

/** A ranked search hit: an item plus its cosine similarity score. */
export interface Ranked<T> {
  item: T;
  score: number;
}
