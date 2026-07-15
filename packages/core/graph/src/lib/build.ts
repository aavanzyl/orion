import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  Hyperedge,
  GraphStats,
} from '@orion/models';

export interface BuildOptions {
  maxNodes?: number;
  maxEdges?: number;
  rootDir?: string;
}

const DEFAULT_MAX_NODES = 10_000;
const DEFAULT_MAX_EDGES = 50_000;

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function disambiguateId(id: string, sourceFile: string): string {
  return `${id}_${hashCode(sourceFile).toString(16)}`;
}

function isAstNode(node: GraphNode): boolean {
  return node.metadata?.['_origin'] === 'ast';
}

function nodeDegree(nodeId: string, edges: GraphEdge[]): number {
  let degree = 0;
  for (const e of edges) {
    if (e.source === nodeId || e.target === nodeId) {
      degree++;
    }
  }
  return degree;
}

function uniqueSourceFiles(nodes: GraphNode[]): number {
  const files = new Set<string>();
  for (const n of nodes) {
    if (n.sourceFile) {
      files.add(n.sourceFile);
    }
  }
  return files.size;
}

export function deduplicateNodes(nodes: GraphNode[]): GraphNode[] {
  const merged = new Map<string, GraphNode>();

  for (const node of nodes) {
    const existing = merged.get(node.id);
    if (!existing) {
      merged.set(node.id, { ...node });
      continue;
    }

    const existingIsAst = isAstNode(existing);
    const incomingIsAst = isAstNode(node);

    if (incomingIsAst && !existingIsAst) {
      merged.set(node.id, { ...node });
      continue;
    }

    if (existingIsAst && !incomingIsAst) {
      continue;
    }

    merged.set(node.id, {
      ...existing,
      ...node,
      metadata: { ...existing.metadata, ...node.metadata },
    });
  }

  return Array.from(merged.values());
}

function deduplicateEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const result: GraphEdge[] = [];

  for (const edge of edges) {
    const key = `${edge.source}|${edge.target}|${edge.relation}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(edge);
    }
  }

  return result;
}

function buildNodeIdIndex(nodes: GraphNode[]): Set<string> {
  const ids = new Set<string>();
  for (const n of nodes) {
    ids.add(n.id);
  }
  return ids;
}

function computeDegreesOnNodes(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  return nodes.map((n) => ({
    ...n,
    degree: nodeDegree(n.id, edges),
  }));
}

function sortNodesByDegreeDesc(nodes: GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));
}

export function computeStats(nodes: GraphNode[], edges: GraphEdge[]): GraphStats {
  const communitySet = new Set<number>();
  for (const n of nodes) {
    if (n.community !== undefined) {
      communitySet.add(n.community);
    }
  }

  let extractedEdges = 0;
  let inferredEdges = 0;
  let ambiguousEdges = 0;

  for (const e of edges) {
    switch (e.confidence) {
      case 'EXTRACTED':
        extractedEdges++;
        break;
      case 'INFERRED':
        inferredEdges++;
        break;
      case 'AMBIGUOUS':
        ambiguousEdges++;
        break;
    }
  }

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    communityCount: communitySet.size,
    extractedEdges,
    inferredEdges,
    ambiguousEdges,
    fileCount: uniqueSourceFiles(nodes),
  };
}

export function buildGraph(
  extractedResults: Array<{ nodes: GraphNode[]; edges: GraphEdge[] }>,
  opts?: BuildOptions,
): KnowledgeGraph {
  const maxNodes = opts?.maxNodes ?? DEFAULT_MAX_NODES;
  const maxEdges = opts?.maxEdges ?? DEFAULT_MAX_EDGES;

  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];

  const seenIds = new Map<string, string>();

  for (const result of extractedResults) {
    const idRemap = new Map<string, string>();

    for (const node of result.nodes) {
      const existingFile = seenIds.get(node.id);

      if (existingFile !== undefined && existingFile !== node.sourceFile) {
        const newId = disambiguateId(node.id, node.sourceFile);
        idRemap.set(node.id, newId);
        allNodes.push({ ...node, id: newId });
        continue;
      }

      seenIds.set(node.id, node.sourceFile);
      allNodes.push(node);
    }

    for (const edge of result.edges) {
      allEdges.push({
        ...edge,
        source: idRemap.get(edge.source) ?? edge.source,
        target: idRemap.get(edge.target) ?? edge.target,
      });
    }
  }

  const dedupedNodes = deduplicateNodes(allNodes);
  const dedupedEdges = deduplicateEdges(allEdges);

  const nodeIdIndex = buildNodeIdIndex(dedupedNodes);
  const validEdges = dedupedEdges.filter(
    (e) => nodeIdIndex.has(e.source) && nodeIdIndex.has(e.target),
  );

  const nodesWithDegrees = computeDegreesOnNodes(dedupedNodes, validEdges);
  const sortedNodes = sortNodesByDegreeDesc(nodesWithDegrees);

  const limitedNodes = sortedNodes.slice(0, maxNodes);
  const limitedNodeIds = buildNodeIdIndex(limitedNodes);
  const limitedEdges = validEdges
    .filter((e) => limitedNodeIds.has(e.source) && limitedNodeIds.has(e.target))
    .slice(0, maxEdges);

  const stats = computeStats(limitedNodes, limitedEdges);

  return {
    nodes: limitedNodes,
    edges: limitedEdges,
    hyperedges: [],
    stats,
  };
}

function serializeGraphToJson(graph: KnowledgeGraph): Record<string, unknown> {
  return {
    directed: true,
    multigraph: false,
    builtAtCommit: graph.builtAtCommit ?? undefined,
    builtAt: graph.builtAt ?? undefined,
    nodes: graph.nodes,
    links: graph.edges,
    hyperedges: graph.hyperedges ?? [],
    stats: graph.stats ?? undefined,
  };
}

export function serializeGraph(graph: KnowledgeGraph): string {
  const now = new Date().toISOString();
  const enriched: KnowledgeGraph = {
    ...graph,
    builtAtCommit: graph.builtAtCommit ?? undefined,
    builtAt: graph.builtAt ?? now,
    stats: graph.stats ?? computeStats(graph.nodes, graph.edges),
  };

  return JSON.stringify(serializeGraphToJson(enriched), null, 2);
}

export function deserializeGraph(json: string): KnowledgeGraph {
  if (!json || json.trim().length === 0) {
    throw new Error('Cannot deserialize empty JSON string');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Failed to parse graph JSON: invalid JSON format');
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Failed to parse graph JSON: root must be an object');
  }

  const obj = parsed as Record<string, unknown>;

  const rawNodes = obj.nodes;
  const rawLinks = obj.links ?? obj.edges;
  const rawHyperedges = obj.hyperedges;

  if (!Array.isArray(rawNodes)) {
    throw new Error('Graph JSON must contain a "nodes" array');
  }

  const nodes: GraphNode[] = rawNodes.map((n: unknown, i: number) => {
    if (typeof n !== 'object' || n === null) {
      throw new Error(`Node at index ${i} is not an object`);
    }
    const node = n as Record<string, unknown>;
    if (typeof node.id !== 'string' || typeof node.label !== 'string' || typeof node.sourceFile !== 'string') {
      throw new Error(
        `Node at index ${i} is missing required fields: id, label, sourceFile`,
      );
    }
    return {
      id: node.id,
      label: node.label,
      fileType: (node.fileType as GraphNode['fileType']) ?? 'code',
      sourceFile: node.sourceFile,
      sourceLocation: typeof node.sourceLocation === 'string' ? node.sourceLocation : undefined,
      community: typeof node.community === 'number' ? node.community : undefined,
      communityName: typeof node.communityName === 'string' ? node.communityName : undefined,
      normLabel: typeof node.normLabel === 'string' ? node.normLabel : undefined,
      degree: typeof node.degree === 'number' ? node.degree : undefined,
      metadata: node.metadata as Record<string, unknown> | undefined,
    };
  });

  let edges: GraphEdge[] = [];

  if (rawLinks !== undefined) {
    if (!Array.isArray(rawLinks)) {
      throw new Error('Graph JSON "links" (or "edges") must be an array');
    }
    edges = rawLinks.map((e: unknown, i: number) => {
      if (typeof e !== 'object' || e === null) {
        throw new Error(`Edge/link at index ${i} is not an object`);
      }
      const edge = e as Record<string, unknown>;
      if (typeof edge.source !== 'string' || typeof edge.target !== 'string' || typeof edge.relation !== 'string') {
        throw new Error(
          `Edge/link at index ${i} is missing required fields: source, target, relation`,
        );
      }
      return {
        source: edge.source,
        target: edge.target,
        relation: edge.relation as GraphEdge['relation'],
        confidence: (edge.confidence as GraphEdge['confidence']) ?? 'EXTRACTED',
        sourceFile: typeof edge.sourceFile === 'string' ? edge.sourceFile : undefined,
        sourceLocation: typeof edge.sourceLocation === 'string' ? edge.sourceLocation : undefined,
        weight: typeof edge.weight === 'number' ? edge.weight : undefined,
        context: typeof edge.context === 'string' ? edge.context : undefined,
        metadata: edge.metadata as Record<string, unknown> | undefined,
      };
    });
  }

  let hyperedges: Hyperedge[] | undefined;
  if (rawHyperedges !== undefined) {
    if (!Array.isArray(rawHyperedges)) {
      throw new Error('Graph JSON "hyperedges" must be an array');
    }
    hyperedges = rawHyperedges.map((h: unknown, i: number) => {
      if (typeof h !== 'object' || h === null) {
        throw new Error(`Hyperedge at index ${i} is not an object`);
      }
      const he = h as Record<string, unknown>;
      if (typeof he.id !== 'string' || typeof he.label !== 'string' || !Array.isArray(he.nodes)) {
        throw new Error(
          `Hyperedge at index ${i} is missing required fields: id, label, nodes`,
        );
      }
      return {
        id: he.id,
        label: he.label,
        nodes: he.nodes as string[],
        sourceFile: typeof he.sourceFile === 'string' ? he.sourceFile : undefined,
        confidence: (he.confidence as Hyperedge['confidence']) ?? 'EXTRACTED',
      };
    });
  }

  const stats: GraphStats | undefined = obj.stats
    ? (obj.stats as GraphStats)
    : undefined;

  return {
    nodes,
    edges,
    hyperedges,
    builtAtCommit: typeof obj.builtAtCommit === 'string' ? obj.builtAtCommit : undefined,
    builtAt: typeof obj.builtAt === 'string' ? obj.builtAt : undefined,
    stats,
  };
}

export function mergeGraphs(graphs: KnowledgeGraph[]): KnowledgeGraph {
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  const allHyperedges: Hyperedge[] = [];

  for (let graphIndex = 0; graphIndex < graphs.length; graphIndex++) {
    const graph = graphs[graphIndex];
    const prefix = `g${graphIndex}_`;
    const idMap = new Map<string, string>();

    for (const node of graph.nodes) {
      const newId = `${prefix}${node.id}`;
      idMap.set(node.id, newId);
      allNodes.push({ ...node, id: newId });
    }

    for (const edge of graph.edges) {
      const newSource = idMap.get(edge.source) ?? edge.source;
      const newTarget = idMap.get(edge.target) ?? edge.target;
      allEdges.push({ ...edge, source: newSource, target: newTarget });
    }

    if (graph.hyperedges) {
      for (const he of graph.hyperedges) {
        allHyperedges.push({
          ...he,
          nodes: he.nodes.map((nid) => idMap.get(nid) ?? nid),
          id: `${prefix}${he.id}`,
        });
      }
    }
  }

  const stats = computeStats(allNodes, allEdges);

  return {
    nodes: allNodes,
    edges: allEdges,
    hyperedges: allHyperedges.length > 0 ? allHyperedges : undefined,
    stats,
  };
}
