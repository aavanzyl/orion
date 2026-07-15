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

export type GraphNodeType = 'file' | 'project_group';

/** A node in the dependency graph — either a file or an NX project group. */
export interface FileGraphNode {
  path: string;
  name: string;
  extension: string;
  chunkCount: number;
  dirname: string;
  importCount: number;
  importedByCount: number;
  /** Pre-computed layout position (server-computed). */
  x?: number;
  y?: number;
  /** Node kind: file node or project group container. */
  nodeType: GraphNodeType;
  /** For project_group nodes: the project type ("application" | "library"). */
  projectType?: string;
  /** For project_group nodes: the number of files inside this project. */
  fileCount?: number;
}

/** Detected NX project metadata parsed from package.json. */
export interface NxProjectInfo {
  name: string;
  root: string;
  projectType: 'application' | 'library';
}

/** An import edge between two files in the graph. */
export interface ImportEdge {
  source: string;
  target: string;
}

/** A directory entry with file counts. */
export interface DirSummary {
  path: string;
  fileCount: number;
  chunkCount: number;
  /** Does this directory contain subdirectories? */
  hasSubdirs: boolean;
}

/** The complete file dependency graph for a project. */
export interface FileGraph {
  nodes: FileGraphNode[];
  edges: ImportEdge[];
}

// --- Call graph: function / endpoint / database-level flow ----------

export type CallNodeType = 'endpoint' | 'function' | 'external' | 'database';

export interface CallGraphNode {
  id: string;
  name: string;
  filePath: string;
  type: CallNodeType;
  line: number;
  x?: number;
  y?: number;
}

export interface CallEdge {
  source: string;
  target: string;
}

export interface CallGraph {
  nodes: CallGraphNode[];
  edges: CallEdge[];
}
