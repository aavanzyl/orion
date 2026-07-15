import fs from 'node:fs';
import path from 'node:path';
import type {
  KnowledgeGraph,
  GraphQueryResult,
  GraphPath,
  GodNode,
  GraphNode,
  GraphEdge,
  GraphRelation,
  GraphConfidence,
} from '@orion/models';

export interface ServeOptions {
  transport?: 'stdio' | 'http';
  port?: number;
  host?: string;
  apiKey?: string;
}

function readFileIfExists(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Graph file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function buildAdjacencyList(nodes: GraphNode[], edges: GraphEdge[]): Map<string, string[]> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, string[]>();

  for (const n of nodes) {
    adj.set(n.id, []);
  }

  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      adj.get(e.source)?.push(e.target);
      adj.get(e.target)?.push(e.source);
    }
  }

  return adj;
}

function bfsShortestPath(
  adj: Map<string, string[]>,
  sourceId: string,
  targetId: string,
): { nodes: string[]; edges: Array<{ source: string; target: string; relation: GraphRelation; confidence: GraphConfidence }> } | null {
  if (sourceId === targetId) {
    return { nodes: [sourceId], edges: [] };
  }

  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: string[] = [sourceId];
  visited.add(sourceId);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const neighbors = adj.get(current) ?? [];

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        queue.push(neighbor);

        if (neighbor === targetId) {
          const pathNodes: string[] = [];
          const pathEdges: Array<{ source: string; target: string; relation: GraphRelation; confidence: GraphConfidence }> = [];
          let node: string | undefined = targetId;

          while (node !== undefined) {
            pathNodes.unshift(node);
            node = parent.get(node);
          }

          for (let i = 0; i < pathNodes.length - 1; i++) {
            pathEdges.push({
              source: pathNodes[i],
              target: pathNodes[i + 1],
              relation: 'depends_on',
              confidence: 'INFERRED',
            });
          }

          return { nodes: pathNodes, edges: pathEdges };
        }
      }
    }
  }

  return null;
}

function bfsLevel(
  adj: Map<string, string[]>,
  seeds: Set<string>,
  depth: number,
): Set<string> {
  if (depth <= 0) return new Set(seeds);

  let current = new Set(seeds);
  const seen = new Set(seeds);

  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const id of current) {
      const neighbors = adj.get(id);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!seen.has(neighbor)) {
            seen.add(neighbor);
            next.add(neighbor);
          }
        }
      }
    }
    current = next;
    if (current.size === 0) break;
  }

  return seen;
}

export function loadGraph(graphPath: string): KnowledgeGraph {
  const raw = readFileIfExists(graphPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse graph file: ${graphPath}`);
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`Graph file ${graphPath} must contain a JSON object`);
  }

  const obj = parsed as Record<string, unknown>;

  const rawNodes = obj.nodes;
  if (!Array.isArray(rawNodes)) {
    throw new Error(`Graph file ${graphPath} must contain a "nodes" array`);
  }

  const nodes: GraphNode[] = rawNodes.map((n: unknown, i: number) => {
    if (typeof n !== 'object' || n === null) {
      throw new Error(`Node at index ${i} in ${graphPath} is not an object`);
    }
    const node = n as Record<string, unknown>;
    return {
      id: String(node.id ?? ''),
      label: String(node.label ?? ''),
      fileType: (node.fileType as GraphNode['fileType']) ?? 'code',
      sourceFile: String(node.sourceFile ?? ''),
      sourceLocation: typeof node.sourceLocation === 'string' ? node.sourceLocation : undefined,
      community: typeof node.community === 'number' ? node.community : undefined,
      communityName: typeof node.communityName === 'string' ? node.communityName : undefined,
      normLabel: typeof node.normLabel === 'string' ? node.normLabel : undefined,
      degree: typeof node.degree === 'number' ? node.degree : undefined,
      metadata: node.metadata as Record<string, unknown> | undefined,
    };
  });

  const rawLinks = obj.links ?? obj.edges;
  let edges: GraphEdge[] = [];

  if (rawLinks !== undefined) {
    if (!Array.isArray(rawLinks)) {
      throw new Error(`Graph file ${graphPath} "links" (or "edges") must be an array`);
    }
    edges = rawLinks.map((e: unknown, i: number) => {
      if (typeof e !== 'object' || e === null) {
        throw new Error(`Edge at index ${i} in ${graphPath} is not an object`);
      }
      const edge = e as Record<string, unknown>;
      return {
        source: String(edge.source ?? ''),
        target: String(edge.target ?? ''),
        relation: (edge.relation as GraphEdge['relation']) ?? 'depends_on',
        confidence: (edge.confidence as GraphEdge['confidence']) ?? 'EXTRACTED',
        sourceFile: typeof edge.sourceFile === 'string' ? edge.sourceFile : undefined,
        sourceLocation: typeof edge.sourceLocation === 'string' ? edge.sourceLocation : undefined,
        weight: typeof edge.weight === 'number' ? edge.weight : undefined,
        context: typeof edge.context === 'string' ? edge.context : undefined,
        metadata: edge.metadata as Record<string, unknown> | undefined,
      };
    });
  }

  const rawHyperedges = obj.hyperedges;
  let hyperedges = undefined;
  if (rawHyperedges !== undefined && Array.isArray(rawHyperedges)) {
    hyperedges = rawHyperedges.map((h: unknown, i: number) => {
      if (typeof h !== 'object' || h === null) {
        throw new Error(`Hyperedge at index ${i} in ${graphPath} is not an object`);
      }
      const he = h as Record<string, unknown>;
      return {
        id: String(he.id ?? ''),
        label: String(he.label ?? ''),
        nodes: Array.isArray(he.nodes) ? he.nodes.map(String) : [],
        sourceFile: typeof he.sourceFile === 'string' ? he.sourceFile : undefined,
        confidence: (he.confidence as 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS') ?? 'EXTRACTED',
      };
    });
  }

  return {
    nodes,
    edges,
    hyperedges,
    builtAtCommit: typeof obj.builtAtCommit === 'string' ? obj.builtAtCommit : undefined,
    builtAt: typeof obj.builtAt === 'string' ? obj.builtAt : undefined,
    stats: obj.stats as KnowledgeGraph['stats'],
  };
}

export function watchGraph(
  graphPath: string,
  onChange: (graph: KnowledgeGraph) => void,
): () => void {
  const dir = path.dirname(graphPath);
  const basename = path.basename(graphPath);
  let lastMtime = 0;

  try {
    const stat = fs.statSync(graphPath);
    lastMtime = stat.mtimeMs;
  } catch {
    lastMtime = 0;
  }

  const watcher = fs.watch(dir, (_eventType, filename) => {
    if (filename !== basename && filename !== null) return;

    try {
      const stat = fs.statSync(graphPath);
      if (stat.mtimeMs > lastMtime) {
        lastMtime = stat.mtimeMs;
        try {
          const graph = loadGraph(graphPath);
          onChange(graph);
        } catch {
          // File may be mid-write; ignore parse errors during watch
        }
      }
    } catch {
      // File may have been deleted; ignore
    }
  });

  return () => {
    watcher.close();
  };
}

export function createGraphServer(graphPath: string): {
  queryGraph: (question: string) => Promise<GraphQueryResult>;
  getNode: (labelOrId: string) => Promise<unknown>;
  getNeighbors: (nodeId: string, relationFilter?: string) => Promise<unknown>;
  getCommunity: (communityId: number) => Promise<unknown>;
  getGodNodes: (topN?: number) => Promise<GodNode[]>;
  shortestPath: (sourceLabel: string, targetLabel: string) => Promise<GraphPath | null>;
  graphStats: () => Promise<unknown>;
  reloadGraph: () => Promise<void>;
} {
  let graph = loadGraph(graphPath);

  const nodeById = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    nodeById.set(n.id, n);
  }

  function rebuildIndexes() {
    nodeById.clear();
    for (const n of graph.nodes) {
      nodeById.set(n.id, n);
    }
  }

  async function queryGraph(question: string): Promise<GraphQueryResult> {
    try {
      const q = question.toLowerCase().trim();
      const seedNodes = graph.nodes.filter(
        (n) => n.label.toLowerCase().includes(q),
      );
      const seeds = seedNodes.map((n) => n.id);
      const seedSet = new Set(seeds);

      const adj = buildAdjacencyList(graph.nodes, graph.edges);
      const reachable = bfsLevel(adj, seedSet, 1);

      const resultNodes = graph.nodes.filter((n) => reachable.has(n.id));
      const reachableSet = new Set(reachable);
      const resultEdges = graph.edges.filter(
        (e) => reachableSet.has(e.source) && reachableSet.has(e.target),
      );

      return {
        question,
        nodes: resultNodes,
        edges: resultEdges,
        seeds,
        traversalType: 'bfs',
        depth: 1,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`queryGraph failed: ${message}`);
    }
  }

  async function getNode(labelOrId: string): Promise<unknown> {
    try {
      const byId = nodeById.get(labelOrId);
      if (byId) return byId;

      const lower = labelOrId.toLowerCase();
      const byLabel = graph.nodes.find(
        (n) => n.label.toLowerCase() === lower,
      );
      if (byLabel) return byLabel;

      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`getNode failed: ${message}`);
    }
  }

  async function getNeighbors(nodeId: string, relationFilter?: string): Promise<unknown> {
    try {
      const node = nodeById.get(nodeId);
      if (!node) return null;

      const neighborIds = new Set<string>();
      const filteredEdges = graph.edges.filter((e) => {
        if (relationFilter && e.relation !== relationFilter) return false;
        if (e.source === nodeId) {
          neighborIds.add(e.target);
          return true;
        }
        if (e.target === nodeId) {
          neighborIds.add(e.source);
          return true;
        }
        return false;
      });

      const neighborNodes = graph.nodes.filter((n) => neighborIds.has(n.id));

      return {
        node,
        neighbors: neighborNodes,
        edges: filteredEdges,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`getNeighbors failed: ${message}`);
    }
  }

  async function getCommunity(communityId: number): Promise<unknown> {
    try {
      const nodes = graph.nodes.filter((n) => n.community === communityId);
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edges = graph.edges.filter(
        (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
      );

      return { id: communityId, nodes, edges, size: nodes.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`getCommunity failed: ${message}`);
    }
  }

  async function getGodNodes(topN?: number): Promise<GodNode[]> {
    try {
      const n = topN ?? 10;
      return graph.nodes
        .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
        .slice(0, n)
        .map((node) => ({
          nodeId: node.id,
          label: node.label,
          degree: node.degree ?? 0,
          sourceFile: node.sourceFile,
          fileType: node.fileType,
        }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`getGodNodes failed: ${message}`);
    }
  }

  async function shortestPath(sourceLabel: string, targetLabel: string): Promise<GraphPath | null> {
    try {
      const sourceLower = sourceLabel.toLowerCase().trim();
      const targetLower = targetLabel.toLowerCase().trim();

      const sourceNode = graph.nodes.find((n) => n.label.toLowerCase() === sourceLower);
      const targetNode = graph.nodes.find((n) => n.label.toLowerCase() === targetLower);

      if (!sourceNode || !targetNode) return null;

      const adj = buildAdjacencyList(graph.nodes, graph.edges);
      const result = bfsShortestPath(adj, sourceNode.id, targetNode.id);

      if (!result) return null;

      return {
        source: sourceNode.label,
        target: targetNode.label,
        hops: result.edges.length,
        path: result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`shortestPath failed: ${message}`);
    }
  }

  async function graphStats(): Promise<unknown> {
    try {
      return graph.stats ?? {
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`graphStats failed: ${message}`);
    }
  }

  async function reloadGraph(): Promise<void> {
    try {
      graph = loadGraph(graphPath);
      rebuildIndexes();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`reloadGraph failed: ${message}`);
    }
  }

  return {
    queryGraph,
    getNode,
    getNeighbors,
    getCommunity,
    getGodNodes,
    shortestPath,
    graphStats,
    reloadGraph,
  };
}
