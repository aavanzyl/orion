import type {
  KnowledgeGraph,
  GraphQueryResult,
  GraphPath,
  GraphNode,
  GraphEdge,
  GraphRelation,
  GraphConfidence,
} from '@orion/models';

export interface QueryOptions {
  traversal?: 'bfs' | 'dfs';
  depth?: number;
  contextFilter?: string;
  maxResults?: number;
  hubPrunePercentile?: number;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
  'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'can', 'could', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'he', 'she', 'it', 'they', 'them', 'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some',
  'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just',
  'about', 'above', 'after', 'again', 'and', 'but', 'or', 'for',
  'nor', 'from', 'at', 'by', 'in', 'into', 'on', 'off', 'out',
  'over', 'under', 'with', 'to', 'up', 'if', 'then', 'there', 'here',
]);

function generateTrigrams(str: string): string[] {
  const trigrams: string[] = [];
  const s = `  ${str}  `;
  for (let i = 0; i < s.length - 2; i++) {
    trigrams.push(s.substring(i, i + 3));
  }
  return trigrams;
}

function buildTrigramIndex(nodes: GraphNode[]): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const node of nodes) {
    const label = node.normLabel ?? node.label.toLowerCase();
    const trigrams = generateTrigrams(label);
    for (const t of trigrams) {
      let nodeSet = idx.get(t);
      if (!nodeSet) {
        nodeSet = new Set();
        idx.set(t, nodeSet);
      }
      nodeSet.add(node.id);
    }
    if (node.sourceFile) {
      const fileTrigrams = generateTrigrams(node.sourceFile.toLowerCase());
      for (const t of fileTrigrams) {
        let nodeSet = idx.get(t);
        if (!nodeSet) {
          nodeSet = new Set();
          idx.set(t, nodeSet);
        }
        nodeSet.add(node.id);
      }
    }
  }
  return idx;
}

export function extractTerms(question: string): string[] {
  const cleaned = question
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = cleaned.split(' ');
  const terms: string[] = [];

  for (const token of tokens) {
    if (token.length === 0) continue;
    if (STOPWORDS.has(token)) continue;
    terms.push(token);
  }

  return terms;
}

export function scoreNodes(
  graph: KnowledgeGraph,
  terms: string[],
): Map<string, number> {
  const scores = new Map<string, number>();
  if (terms.length === 0) return scores;

  const trigramIndex = buildTrigramIndex(graph.nodes);

  const termDf = new Map<string, number>();
  for (const term of terms) {
    const trigrams = generateTrigrams(term);
    const matchingNodes = new Set<string>();
    for (const t of trigrams) {
      const nodeSet = trigramIndex.get(t);
      if (nodeSet) {
        for (const id of nodeSet) {
          matchingNodes.add(id);
        }
      }
    }
    termDf.set(term, matchingNodes.size);
  }

  const totalNodes = graph.nodes.length;
  const idf = new Map<string, number>();
  for (const term of terms) {
    const df = termDf.get(term) ?? 0;
    idf.set(term, df > 0 ? Math.log((totalNodes + 1) / (df + 1)) : 0);
  }

  const fullQuery = terms.join(' ');
  const fullQueryLower = fullQuery.toLowerCase();

  const nodeMap = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    nodeMap.set(n.id, n);
  }

  const candidateIds = new Set<string>();
  for (const term of terms) {
    const trigrams = generateTrigrams(term);
    for (const t of trigrams) {
      const nodeSet = trigramIndex.get(t);
      if (nodeSet) {
        for (const id of nodeSet) {
          candidateIds.add(id);
        }
      }
    }
  }

  for (const nodeId of candidateIds) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const label = node.normLabel ?? node.label.toLowerCase();
    let nodeScore = 0;
    let matchedTerms = 0;

    if (label === fullQueryLower) {
      nodeScore += 10000;
      matchedTerms = terms.length;
    } else {
      for (const term of terms) {
        const termIdf = idf.get(term) ?? 0;

        if (label === term) {
          nodeScore += 1000 * termIdf;
          matchedTerms++;
        } else if (label.startsWith(term)) {
          nodeScore += 100 * termIdf;
          matchedTerms++;
        } else if (label.includes(term)) {
          nodeScore += 1 * termIdf;
          matchedTerms++;
        }
      }
    }

    if (node.sourceFile) {
      const sourceFile = node.sourceFile.toLowerCase();
      for (const term of terms) {
        if (sourceFile.includes(term)) {
          nodeScore += 0.5;
        }
      }
    }

    if (matchedTerms > 0) {
      const coverageScale = (matchedTerms / terms.length) * (matchedTerms / terms.length);
      nodeScore *= coverageScale;
    }

    if (nodeScore > 0) {
      scores.set(nodeId, nodeScore);
    }
  }

  return scores;
}

export function traverse(
  graph: KnowledgeGraph,
  seeds: string[],
  opts?: QueryOptions,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const traversal = opts?.traversal ?? 'bfs';
  const depth = opts?.depth ?? (traversal === 'bfs' ? 3 : 2);
  const maxResults = opts?.maxResults ?? 200;
  const hubPrunePercentile = opts?.hubPrunePercentile ?? 99;
  const contextFilter = opts?.contextFilter;

  const nodeMap = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    nodeMap.set(n.id, n);
  }

  const degrees: number[] = [];
  for (const n of graph.nodes) {
    degrees.push(n.degree ?? 0);
  }
  degrees.sort((a, b) => a - b);
  let hubThreshold = Infinity;
  if (degrees.length > 0) {
    const idx = Math.floor((hubPrunePercentile / 100) * (degrees.length - 1));
    hubThreshold = degrees[idx];
  }

  const adj = new Map<string, Array<{ target: string; edge: GraphEdge }>>();
  for (const e of graph.edges) {
    if (contextFilter && e.context !== contextFilter) continue;
    let srcArr = adj.get(e.source);
    if (!srcArr) {
      srcArr = [];
      adj.set(e.source, srcArr);
    }
    srcArr.push({ target: e.target, edge: e });
    let tgtArr = adj.get(e.target);
    if (!tgtArr) {
      tgtArr = [];
      adj.set(e.target, tgtArr);
    }
    tgtArr.push({ target: e.source, edge: e });
  }

  const visited = new Set<string>();
  const selectedNodes: GraphNode[] = [];
  const selectedEdges: GraphEdge[] = [];
  const selectedEdgeSet = new Set<string>();
  const nodeDepths = new Map<string, number>();

  if (traversal === 'bfs') {
    const queue: Array<{ id: string; depth: number }> = [];
    for (const seed of seeds) {
      if (nodeMap.has(seed)) {
        queue.push({ id: seed, depth: 0 });
      }
    }

    while (queue.length > 0 && selectedNodes.length < maxResults) {
      const item = queue.shift();
      if (!item) continue;
      const { id, depth: d } = item;
      if (visited.has(id)) continue;
      if (d > depth) continue;
      visited.add(id);
      const currentNode = nodeMap.get(id);
      if (!currentNode) continue;
      selectedNodes.push(currentNode);
      nodeDepths.set(id, d);

      if (d >= depth) continue;

      const neighbors = adj.get(id);
      if (!neighbors) continue;

      const nodeDeg = nodeMap.get(id)?.degree ?? 0;
      if (nodeDeg > hubThreshold) continue;

      for (const { target, edge } of neighbors) {
        if (!visited.has(target)) {
          queue.push({ id: target, depth: d + 1 });
        }
        const edgeKey = `${edge.source}|${edge.target}|${edge.relation}`;
        if (!selectedEdgeSet.has(edgeKey)) {
          selectedEdgeSet.add(edgeKey);
          selectedEdges.push(edge);
        }
      }
    }
  } else {
    const stack: Array<{ id: string; depth: number }> = [];
    for (const seed of seeds.reverse()) {
      if (nodeMap.has(seed)) {
        stack.push({ id: seed, depth: 0 });
      }
    }

    while (stack.length > 0 && selectedNodes.length < maxResults) {
      const item = stack.pop();
      if (!item) continue;
      const { id, depth: d } = item;
      if (visited.has(id)) continue;
      if (d > depth) continue;
      visited.add(id);
      const currentNode = nodeMap.get(id);
      if (!currentNode) continue;
      selectedNodes.push(currentNode);
      nodeDepths.set(id, d);

      if (d >= depth) continue;

      const neighbors = adj.get(id);
      if (!neighbors) continue;

      const nodeDeg = nodeMap.get(id)?.degree ?? 0;
      if (nodeDeg > hubThreshold) continue;

      for (const { target, edge } of neighbors) {
        if (!visited.has(target)) {
          stack.push({ id: target, depth: d + 1 });
        }
        const edgeKey = `${edge.source}|${edge.target}|${edge.relation}`;
        if (!selectedEdgeSet.has(edgeKey)) {
          selectedEdgeSet.add(edgeKey);
          selectedEdges.push(edge);
        }
      }
    }
  }

  return { nodes: selectedNodes, edges: selectedEdges };
}

export function queryGraph(
  graph: KnowledgeGraph,
  question: string,
  opts?: QueryOptions,
): GraphQueryResult {
  const terms = extractTerms(question);
  const scores = scoreNodes(graph, terms);

  const sorted = Array.from(scores.entries()).sort(
    (a, b) => b[1] - a[1],
  );

  const seeds: string[] = [];
  for (let i = 0; i < Math.min(sorted.length, 3); i++) {
    if (i > 0) {
      const prevScore = sorted[i - 1][1];
      const currScore = sorted[i][1];
      if (prevScore > 0 && currScore / prevScore < 0.2) break;
    }
    seeds.push(sorted[i][0]);
  }

  if (seeds.length === 0) {
    return {
      question,
      nodes: [],
      edges: [],
      seeds: [],
      traversalType: opts?.traversal ?? 'bfs',
      depth: opts?.depth ?? 3,
    };
  }

  const { nodes, edges } = traverse(graph, seeds, opts);

  return {
    question,
    nodes,
    edges,
    seeds,
    traversalType: opts?.traversal ?? 'bfs',
    depth: opts?.depth ?? 3,
  };
}

export function findPath(
  graph: KnowledgeGraph,
  source: string,
  target: string,
): GraphPath | null {
  const nodeMap = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    nodeMap.set(n.id, n);
  }

  if (!nodeMap.has(source) || !nodeMap.has(target)) return null;

  if (source === target) {
    return {
      source,
      target,
      hops: 0,
      path: { nodes: [source], edges: [] },
    };
  }

  const adj = new Map<string, Array<{ neighbor: string; edge: { source: string; target: string; relation: GraphRelation; confidence: GraphConfidence } }>>();
  for (const e of graph.edges) {
    const edgeInfo = {
      source: e.source,
      target: e.target,
      relation: e.relation,
      confidence: e.confidence,
    };
    let srcArr = adj.get(e.source);
    if (!srcArr) {
      srcArr = [];
      adj.set(e.source, srcArr);
    }
    srcArr.push({ neighbor: e.target, edge: edgeInfo });
    let tgtArr = adj.get(e.target);
    if (!tgtArr) {
      tgtArr = [];
      adj.set(e.target, tgtArr);
    }
    tgtArr.push({ neighbor: e.source, edge: edgeInfo });
  }

  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const parentEdge = new Map<string, { source: string; target: string; relation: GraphRelation; confidence: GraphConfidence }>();

  const queue = [source];
  visited.add(source);

  let found = false;
  while (queue.length > 0 && !found) {
    const current = queue.shift();
    if (!current) continue;
    const neighbors = adj.get(current);
    if (!neighbors) continue;

    for (const { neighbor, edge } of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        parentEdge.set(neighbor, edge);
        queue.push(neighbor);
        if (neighbor === target) {
          found = true;
          break;
        }
      }
    }
  }

  if (!found) return null;

  const nodePath: string[] = [];
  const edgePath: Array<{
    source: string;
    target: string;
    relation: GraphRelation;
    confidence: GraphConfidence;
  }> = [];

  let current = target;
  while (current !== source) {
    nodePath.unshift(current);
    const edge = parentEdge.get(current);
    if (edge) edgePath.unshift(edge);
    const next = parent.get(current);
    if (!next) break;
    current = next;
  }
  nodePath.unshift(source);

  return {
    source,
    target,
    hops: nodePath.length - 1,
    path: { nodes: nodePath, edges: edgePath },
  };
}

export function explainNode(
  graph: KnowledgeGraph,
  nodeLabel: string,
): {
  node: GraphNode;
  outgoingEdges: GraphEdge[];
  incomingEdges: GraphEdge[];
  degree: number;
  community?: number;
} | null {
  const node = graph.nodes.find(
    (n) => n.label === nodeLabel || n.id === nodeLabel,
  );

  if (!node) return null;

  const outgoingEdges: GraphEdge[] = [];
  const incomingEdges: GraphEdge[] = [];

  for (const e of graph.edges) {
    if (e.source === node.id) {
      outgoingEdges.push(e);
    }
    if (e.target === node.id) {
      incomingEdges.push(e);
    }
  }

  return {
    node,
    outgoingEdges,
    incomingEdges,
    degree: node.degree ?? outgoingEdges.length + incomingEdges.length,
    community: node.community,
  };
}
