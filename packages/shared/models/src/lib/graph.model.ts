/** Edge confidence levels — how sure we are about a relationship. */
export type GraphConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

/** All possible edge relations in the knowledge graph. */
export type GraphRelation =
  | 'calls'
  | 'imports'
  | 'imports_from'
  | 're_exports'
  | 'inherits'
  | 'implements'
  | 'mixes_in'
  | 'embeds'
  | 'references'
  | 'contains'
  | 'method'
  | 'rationale_for'
  | 'depends_on'
  | 'uses';

/** File / source types for graph nodes. */
export type GraphNodeKind = 'code' | 'document' | 'rationale' | 'concept' | 'package';

/** A node in the knowledge graph. */
export interface GraphNode {
  /** Canonical identifier (e.g. "src_auth_handler"). */
  id: string;
  /** Human-readable display name. */
  label: string;
  /** What kind of source this node represents. */
  fileType: GraphNodeKind;
  /** Repo-relative path. */
  sourceFile: string;
  /** e.g. "L42" for line number. */
  sourceLocation?: string;
  /** Community ID from clustering. */
  community?: number;
  /** Human-readable community label. */
  communityName?: string;
  /** Normalized label for search (lowercase, no diacritics). */
  normLabel?: string;
  /** Degree in the graph (computed). */
  degree?: number;
  /** Arbitrary extra data. */
  metadata?: Record<string, unknown>;
}

/** An edge in the knowledge graph. */
export interface GraphEdge {
  /** Source node ID. */
  source: string;
  /** Target node ID. */
  target: string;
  /** Relationship type. */
  relation: GraphRelation;
  /** How sure we are about this edge. */
  confidence: GraphConfidence;
  /** File where the relationship was observed. */
  sourceFile?: string;
  /** Line number in source file. */
  sourceLocation?: string;
  /** Edge weight (default 1.0). */
  weight?: number;
  /** Additional context about the relationship. */
  context?: string;
  metadata?: Record<string, unknown>;
}

/** A hyperedge connecting multiple nodes (for group relationships). */
export interface Hyperedge {
  id: string;
  label: string;
  /** Node IDs in this hyperedge. */
  nodes: string[];
  sourceFile?: string;
  confidence: GraphConfidence;
}

/** The complete knowledge graph. */
export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hyperedges?: Hyperedge[];
  builtAtCommit?: string;
  /** ISO timestamp. */
  builtAt?: string;
  stats?: GraphStats;
}

/** Statistics about the graph. */
export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  extractedEdges: number;
  inferredEdges: number;
  ambiguousEdges: number;
  fileCount: number;
}

/** A high-degree node (god node) ranking entry. */
export interface GodNode {
  nodeId: string;
  label: string;
  degree: number;
  sourceFile: string;
  fileType: GraphNodeKind;
}

/** A surprising connection between concepts. */
export interface SurprisingConnection {
  source: string;
  sourceLabel: string;
  target: string;
  targetLabel: string;
  relation: GraphRelation;
  confidence: GraphConfidence;
  /** Surprise score (higher = more surprising). */
  score: number;
  /** Explanation of why this is surprising. */
  why: string;
}

/** A community in the graph. */
export interface GraphCommunity {
  id: number;
  label: string;
  size: number;
  /** Internal edge density (0-1). */
  cohesion?: number;
  /** Node IDs in this community. */
  memberIds: string[];
}

/** Subgraph returned from a query. */
export interface GraphQueryResult {
  question: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Node IDs used as traversal seeds. */
  seeds: string[];
  traversalType: 'bfs' | 'dfs';
  depth: number;
}

/** Path between two nodes. */
export interface GraphPath {
  source: string;
  target: string;
  hops: number;
  path: {
    nodes: string[];
    edges: Array<{
      source: string;
      target: string;
      relation: GraphRelation;
      confidence: GraphConfidence;
    }>;
  };
}

