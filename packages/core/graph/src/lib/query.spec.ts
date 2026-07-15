import { describe, it, expect } from 'vitest';
import {
  extractTerms,
  scoreNodes,
  queryGraph,
  findPath,
  explainNode,
  traverse,
} from './query.js';
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
} from '@orion/models';

function createTestGraph(): KnowledgeGraph {
  const nodes: GraphNode[] = [
    { id: 'n1', label: 'authenticate', fileType: 'code', sourceFile: 'src/auth.ts', degree: 3, community: 0 },
    { id: 'n2', label: 'validateToken', fileType: 'code', sourceFile: 'src/auth.ts', degree: 2, community: 0 },
    { id: 'n3', label: 'hashPassword', fileType: 'code', sourceFile: 'src/auth.ts', degree: 1, community: 0 },
    { id: 'n4', label: 'connect', fileType: 'code', sourceFile: 'src/database.ts', degree: 3, community: 1 },
    { id: 'n5', label: 'query', fileType: 'code', sourceFile: 'src/database.ts', degree: 2, community: 1 },
    { id: 'n6', label: 'parseJSON', fileType: 'code', sourceFile: 'src/utils.ts', degree: 1, community: 2 },
    { id: 'n7', label: 'formatDate', fileType: 'code', sourceFile: 'src/utils.ts', degree: 1, community: 2 },
    { id: 'n8', label: 'handleRequest', fileType: 'code', sourceFile: 'src/routes.ts', degree: 2, community: 0 },
    { id: 'isolated', label: 'orphanFunction', fileType: 'code', sourceFile: 'src/orphan.ts', degree: 0 },
    { id: 'dangling', label: 'soloFunction', fileType: 'code', sourceFile: 'src/solo.ts', degree: 1 },
    { id: 'hub1', label: 'orchestrator', fileType: 'code', sourceFile: 'src/orchestrator.ts', degree: 10, community: 0 },
  ];

  const edges: GraphEdge[] = [
    { source: 'n1', target: 'n2', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 'n1', target: 'n3', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 'n1', target: 'n4', relation: 'calls', confidence: 'AMBIGUOUS' },
    { source: 'n4', target: 'n5', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 'n5', target: 'n6', relation: 'calls', confidence: 'INFERRED' },
    { source: 'n8', target: 'n1', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 'n7', target: 'dangling', relation: 'references', confidence: 'EXTRACTED' },
    { source: 'hub1', target: 'n1', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 'hub1', target: 'n4', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 'hub1', target: 'n8', relation: 'calls', confidence: 'EXTRACTED' },
  ];

  return { nodes, edges };
}

describe('extractTerms', () => {
  it('extracts meaningful words from a question', () => {
    const terms = extractTerms('How does authentication work?');
    expect(terms).toContain('authentication');
    expect(terms).toContain('work');
    expect(terms).not.toContain('how');
    expect(terms).not.toContain('does');
  });

  it('filters English stopwords', () => {
    const terms = extractTerms('the quick brown fox jumps over the lazy dog');
    expect(terms).toEqual(['quick', 'brown', 'fox', 'jumps', 'lazy', 'dog']);
  });

  it('handles empty string', () => {
    const terms = extractTerms('');
    expect(terms).toEqual([]);
  });

  it('handles only stopwords', () => {
    const terms = extractTerms('the and for with in on at');
    expect(terms).toEqual([]);
  });

  it('handles punctuation', () => {
    const terms = extractTerms('Hello, world! How are you?');
    expect(terms).toContain('hello');
    expect(terms).toContain('world');
    expect(terms).not.toContain('how');
    expect(terms).not.toContain('are');
    expect(terms).not.toContain('you');
    expect(terms.length).toBe(2);
  });

  it('handles question marks and hyphens', () => {
    const terms = extractTerms('Is this real-time ready-to-go?');
    expect(terms).toContain('real');
    expect(terms).toContain('time');
    expect(terms).toContain('ready');
    expect(terms).toContain('go');
  });
});

describe('scoreNodes', () => {
  const graph = createTestGraph();

  it('exact label match gets the highest score', () => {
    const scores = scoreNodes(graph, ['authenticate']);

    const authScore = scores.get('n1');
    expect(authScore).toBeDefined();
    expect(authScore).toBeGreaterThan(0);

    let maxScore = 0;
    let maxId = '';
    for (const [id, score] of scores) {
      if (score > maxScore) {
        maxScore = score;
        maxId = id;
      }
    }
    expect(maxId).toBe('n1');
  });

  it('substring match gets a positive but lower score', () => {
    const scores = scoreNodes(graph, ['authenticate']);
    const exactScore = scores.get('n1');

    const scores2 = scoreNodes(graph, ['auth']);
    const subScore = scores2.get('n1');

    expect(subScore).toBeDefined();
    expect(subScore).toBeGreaterThan(0);
    expect(exactScore).toBeGreaterThan(subScore);
  });

  it('source file match contributes to score', () => {
    const scores = scoreNodes(graph, ['database']);
    const dbScore = scores.get('n4');
    expect(dbScore).toBeDefined();
    expect(dbScore).toBeGreaterThan(0);
  });

  it('multiple term matches accumulate', () => {
    const singleTermScores = scoreNodes(graph, ['validate']);
    const singleScore = singleTermScores.get('n2');

    const multiTermScores = scoreNodes(graph, ['validate', 'token']);
    const multiScore = multiTermScores.get('n2');

    expect(singleScore).toBeDefined();
    expect(multiScore).toBeDefined();
    expect(singleScore).toBeGreaterThan(0);
    expect(multiScore).toBeGreaterThan(singleScore!);
  });

  it('returns empty map for no terms', () => {
    const scores = scoreNodes(graph, []);
    expect(scores.size).toBe(0);
  });

  it('returns empty map when no nodes match terms', () => {
    const scores = scoreNodes(graph, ['xyznonexistent123']);
    expect(scores.size).toBe(0);
  });

  it('uses normLabel for trigram indexing when present', () => {
    const graphWithNorm: KnowledgeGraph = {
      nodes: [
        ...graph.nodes,
        { id: 'normTest', label: 'CamelCase', normLabel: 'camelcase', fileType: 'code', sourceFile: 'src/test.ts', degree: 1 },
      ],
      edges: graph.edges,
    };
    const scores = scoreNodes(graphWithNorm, ['camelcase']);
    expect(scores.has('normTest')).toBe(true);
  });
});

describe('queryGraph', () => {
  const graph = createTestGraph();

  it('returns subgraph for a simple query', () => {
    const result = queryGraph(graph, 'authenticate');
    expect(result.question).toBe('authenticate');
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.seeds.length).toBeGreaterThan(0);
    expect(result.traversalType).toBe('bfs');
  });

  it('respects depth limit', () => {
    const deepResult = queryGraph(graph, 'authenticate', { depth: 1 });
    const shallowResult = queryGraph(graph, 'authenticate', { depth: 5 });

    expect(deepResult.nodes.length).toBeLessThanOrEqual(shallowResult.nodes.length);
    expect(deepResult.depth).toBe(1);
    expect(shallowResult.depth).toBe(5);
  });

  it('returns empty result for no matches', () => {
    const result = queryGraph(graph, 'xyznonexistent123');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.seeds).toEqual([]);
  });

  it('BFS and DFS produce different traversals', () => {
    const bfsResult = queryGraph(graph, 'authenticate', { traversal: 'bfs' });
    const dfsResult = queryGraph(graph, 'authenticate', { traversal: 'dfs' });

    const bfsOrder = bfsResult.nodes.map((n) => n.id);
    const dfsOrder = dfsResult.nodes.map((n) => n.id);

    expect(bfsResult.traversalType).toBe('bfs');
    expect(dfsResult.traversalType).toBe('dfs');

    const bfsJoined = bfsOrder.join(',');
    const dfsJoined = dfsOrder.join(',');

    expect(bfsJoined).not.toBe(dfsJoined);
  });

  it('hub pruning limits expansion from high-degree nodes', () => {
    const withoutPruning = queryGraph(graph, 'authenticate', { hubPrunePercentile: 100 });
    const withPruning = queryGraph(graph, 'authenticate', { hubPrunePercentile: 50 });

    const hasHubWithoutPruning = withoutPruning.nodes.some((n) => n.id === 'hub1');
    const hasHubWithPruning = withPruning.nodes.some((n) => n.id === 'hub1');

    expect(hasHubWithoutPruning).toBe(true);
    expect(hasHubWithPruning).toBe(false);
  });
});

describe('findPath', () => {
  const graph = createTestGraph();

  it('finds shortest path between directly connected nodes', () => {
    const path = findPath(graph, 'n1', 'n4');
    expect(path).not.toBeNull();
    expect(path!.hops).toBe(1);
    expect(path!.source).toBe('n1');
    expect(path!.target).toBe('n4');
    expect(path!.path.nodes).toEqual(['n1', 'n4']);
    expect(path!.path.edges).toHaveLength(1);
  });

  it('finds path through intermediate nodes', () => {
    const path = findPath(graph, 'n8', 'n5');
    expect(path).not.toBeNull();
    expect(path!.hops).toBe(3);
    expect(path!.source).toBe('n8');
    expect(path!.target).toBe('n5');
    expect(path!.path.nodes[0]).toBe('n8');
    expect(path!.path.nodes[path!.path.nodes.length - 1]).toBe('n5');
  });

  it('returns null when no path exists', () => {
    const path = findPath(graph, 'n1', 'isolated');
    expect(path).toBeNull();
  });

  it('returns null for non-existent source', () => {
    const path = findPath(graph, 'nonexistent', 'n1');
    expect(path).toBeNull();
  });

  it('returns null for non-existent target', () => {
    const path = findPath(graph, 'n1', 'nonexistent');
    expect(path).toBeNull();
  });

  it('returns zero-hop path when source equals target', () => {
    const path = findPath(graph, 'n1', 'n1');
    expect(path).not.toBeNull();
    expect(path!.hops).toBe(0);
    expect(path!.path.nodes).toEqual(['n1']);
    expect(path!.path.edges).toEqual([]);
  });
});

describe('explainNode', () => {
  const graph = createTestGraph();

  it('returns node details for existing node by label', () => {
    const result = explainNode(graph, 'authenticate');
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe('n1');
    expect(result!.node.label).toBe('authenticate');
    expect(result!.outgoingEdges.length).toBeGreaterThan(0);
    expect(result!.incomingEdges.length).toBeGreaterThan(0);
  });

  it('returns node details for existing node by id', () => {
    const result = explainNode(graph, 'n1');
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe('n1');
  });

  it('returns null for non-existent node', () => {
    const result = explainNode(graph, 'nonexistent');
    expect(result).toBeNull();
  });

  it('lists incoming and outgoing edges', () => {
    const result = explainNode(graph, 'authenticate');

    expect(result).not.toBeNull();
    expect(result!.outgoingEdges).toHaveLength(3);

    expect(result!.incomingEdges).toHaveLength(2);

    const outgoingTargets = result!.outgoingEdges.map((e) => e.target);
    expect(outgoingTargets).toContain('n2');
    expect(outgoingTargets).toContain('n3');
    expect(outgoingTargets).toContain('n4');

    const incomingSources = result!.incomingEdges.map((e) => e.source);
    expect(incomingSources).toContain('n8');
    expect(incomingSources).toContain('hub1');
  });

  it('returns correct degree and community', () => {
    const result = explainNode(graph, 'authenticate');
    expect(result).not.toBeNull();
    expect(result!.degree).toBe(3);
    expect(result!.community).toBe(0);
  });

  it('handles node with no edges', () => {
    const result = explainNode(graph, 'orphanFunction');
    expect(result).not.toBeNull();
    expect(result!.outgoingEdges).toEqual([]);
    expect(result!.incomingEdges).toEqual([]);
    expect(result!.degree).toBe(0);
  });
});

describe('traverse', () => {
  const graph = createTestGraph();

  it('BFS from seed returns nodes in breadth-first order', () => {
    const { nodes } = traverse(graph, ['n1'], { traversal: 'bfs', depth: 2 });
    const ids = nodes.map((n) => n.id);

    expect(ids.indexOf('n1')).toBe(0);

    const n1idx = ids.indexOf('n1');
    const n2idx = ids.indexOf('n2');
    const n3idx = ids.indexOf('n3');
    const n4idx = ids.indexOf('n4');
    const n8idx = ids.indexOf('n8');

    expect(n2idx).toBeGreaterThan(n1idx);
    expect(n3idx).toBeGreaterThan(n1idx);
    expect(n4idx).toBeGreaterThan(n1idx);
    expect(n8idx).toBeGreaterThan(n1idx);
  });

  it('DFS from seed returns nodes in depth-first order', () => {
    const { nodes } = traverse(graph, ['n1'], { traversal: 'dfs', depth: 2 });
    const ids = nodes.map((n) => n.id);

    expect(ids[0]).toBe('n1');

    expect(ids.indexOf('n1')).toBe(0);
  });

  it('respects depth limit', () => {
    const { nodes: shallow } = traverse(graph, ['n1'], { depth: 1 });
    const { nodes: deep } = traverse(graph, ['n1'], { depth: 5 });

    expect(shallow.length).toBeLessThan(deep.length);
  });

  it('handles empty seeds array', () => {
    const { nodes, edges } = traverse(graph, []);
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });

  it('handles non-existent seed id', () => {
    const { nodes } = traverse(graph, ['nonexistent']);
    expect(nodes).toEqual([]);
  });

  it('DFS ordering differs from BFS ordering', () => {
    const { nodes: bfsNodes } = traverse(graph, ['n1'], { traversal: 'bfs', depth: 3 });
    const { nodes: dfsNodes } = traverse(graph, ['n1'], { traversal: 'dfs', depth: 3 });

    const bfsIds = bfsNodes.map((n) => n.id);
    const dfsIds = dfsNodes.map((n) => n.id);

    const bfsJoined = bfsIds.join(',');
    const dfsJoined = dfsIds.join(',');

    expect(bfsJoined).not.toBe(dfsJoined);
  });

  it('returns edges for traversed nodes', () => {
    const { nodes, edges } = traverse(graph, ['n1'], { depth: 1 });

    expect(nodes.length).toBeGreaterThan(0);
    expect(edges.length).toBeGreaterThan(0);
  });

  it('respects maxResults option', () => {
    const { nodes: limited } = traverse(graph, ['n1'], { maxResults: 2, depth: 5 });
    expect(limited.length).toBeLessThanOrEqual(2);
  });

  it('filters edges by contextFilter', () => {
    const graphWithContext: KnowledgeGraph = {
      nodes: [
        { id: 'a', label: 'A', fileType: 'code', sourceFile: 'src/a.ts', degree: 1 },
        { id: 'b', label: 'B', fileType: 'code', sourceFile: 'src/b.ts', degree: 1 },
        { id: 'c', label: 'C', fileType: 'code', sourceFile: 'src/c.ts', degree: 1 },
      ],
      edges: [
        { source: 'a', target: 'b', relation: 'calls', confidence: 'EXTRACTED', context: 'test' },
        { source: 'b', target: 'c', relation: 'calls', confidence: 'EXTRACTED', context: 'production' },
      ],
    };

    const { edges: filteredEdges } = traverse(graphWithContext, ['a'], { depth: 2, contextFilter: 'test' });

    expect(filteredEdges.length).toBe(1);
    expect(filteredEdges[0].source).toBe('a');
    expect(filteredEdges[0].target).toBe('b');
  });
});
