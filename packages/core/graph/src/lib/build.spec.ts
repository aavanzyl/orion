import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  serializeGraph,
  deserializeGraph,
  computeStats,
  deduplicateNodes,
  mergeGraphs,
} from './build.js';
import type { GraphNode, GraphEdge, KnowledgeGraph, GraphStats } from '@orion/models';

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'node1',
    label: 'Node 1',
    fileType: 'code',
    sourceFile: 'src/index.ts',
    ...overrides,
  };
}

function makeEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    source: 'a',
    target: 'b',
    relation: 'imports',
    confidence: 'EXTRACTED',
    ...overrides,
  };
}

function makeStats(overrides: Partial<GraphStats> = {}): GraphStats {
  return {
    nodeCount: 0,
    edgeCount: 0,
    communityCount: 0,
    extractedEdges: 0,
    inferredEdges: 0,
    ambiguousEdges: 0,
    fileCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildGraph
// ---------------------------------------------------------------------------
describe('buildGraph', () => {
  it('merges nodes from multiple extraction results', () => {
    const r1 = { nodes: [makeNode({ id: 'a' }), makeNode({ id: 'b' })], edges: [] };
    const r2 = { nodes: [makeNode({ id: 'c' }), makeNode({ id: 'd' })], edges: [] };
    const g = buildGraph([r1, r2]);

    expect(g.nodes).toHaveLength(4);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('deduplicates nodes with the same ID and source file', () => {
    const r1 = { nodes: [makeNode({ id: 'dup', label: 'first' })], edges: [] };
    const r2 = { nodes: [makeNode({ id: 'dup', label: 'second' })], edges: [] };
    const g = buildGraph([r1, r2]);

    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].label).toBe('second');
  });

  it('preserves AST node attributes over non-AST nodes', () => {
    const nonAst = makeNode({ id: 'dup', label: 'non-ast', metadata: { key: 'val' } });
    const astNode = makeNode({ id: 'dup', label: 'ast-node', metadata: { _origin: 'ast' } });
    const g = buildGraph([{ nodes: [nonAst], edges: [] }, { nodes: [astNode], edges: [] }]);

    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].label).toBe('ast-node');
    expect(g.nodes[0].metadata?._origin).toBe('ast');
  });

  it('filters edges with invalid endpoints', () => {
    const nodes = [makeNode({ id: 'a' })];
    const edges = [makeEdge({ source: 'a', target: 'b' }), makeEdge({ source: 'c', target: 'a' })];
    const g = buildGraph([{ nodes, edges }]);

    expect(g.edges).toHaveLength(0);
  });

  it('computes degree correctly for each node', () => {
    const nodes = [
      makeNode({ id: 'high' }),
      makeNode({ id: 'mid' }),
      makeNode({ id: 'low' }),
    ];
    const edges = [
      makeEdge({ source: 'high', target: 'mid', relation: 'imports' }),
      makeEdge({ source: 'high', target: 'low', relation: 'calls' }),
    ];
    const g = buildGraph([{ nodes, edges }]);

    const highNode = g.nodes.find((n) => n.id === 'high');
    const midNode = g.nodes.find((n) => n.id === 'mid');
    const lowNode = g.nodes.find((n) => n.id === 'low');

    expect(highNode?.degree).toBe(2);
    expect(midNode?.degree).toBe(1);
    expect(lowNode?.degree).toBe(1);
  });

  it('respects maxNodes limit', () => {
    const nodes = Array.from({ length: 5 }, (_, i) => makeNode({ id: `n${i}` }));
    const g = buildGraph([{ nodes, edges: [] }], { maxNodes: 3 });

    expect(g.nodes).toHaveLength(3);
  });

  it('respects maxEdges limit', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' })];
    const edges = [
      makeEdge({ source: 'a', target: 'b', relation: 'imports' }),
      makeEdge({ source: 'a', target: 'b', relation: 'calls' }),
      makeEdge({ source: 'a', target: 'b', relation: 'references' }),
    ];
    const g = buildGraph([{ nodes, edges }], { maxEdges: 2 });

    expect(g.edges).toHaveLength(2);
  });

  it('sorts nodes by degree descending', () => {
    const nodes = [
      makeNode({ id: 'low' }),
      makeNode({ id: 'high' }),
      makeNode({ id: 'mid' }),
    ];
    const edges = [
      makeEdge({ source: 'high', target: 'mid', relation: 'imports' }),
      makeEdge({ source: 'high', target: 'low', relation: 'calls' }),
    ];
    const g = buildGraph([{ nodes, edges }]);

    expect(g.nodes[0].id).toBe('high');
  });

  it('handles empty input arrays', () => {
    const g = buildGraph([]);

    expect(g.nodes).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
    expect(g.stats?.nodeCount).toBe(0);
  });

  it('uses a single extraction result correctly', () => {
    const nodes = [makeNode({ id: 'a' })];
    const edges = [makeEdge({ source: 'a', target: 'a' })];
    const g = buildGraph([{ nodes, edges }]);

    expect(g.nodes).toHaveLength(1);
    expect(g.edges).toHaveLength(1);
  });

  it('disambiguates nodes with same ID from different source files', () => {
    const r1 = { nodes: [makeNode({ id: 'dupe', sourceFile: 'src/a.ts' })], edges: [] };
    const r2 = { nodes: [makeNode({ id: 'dupe', sourceFile: 'src/b.ts' })], edges: [] };
    const g = buildGraph([r1, r2]);

    expect(g.nodes).toHaveLength(2);
    const ids = g.nodes.map((n) => n.id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids).toContain('dupe');
    expect(ids.some((id) => id !== 'dupe')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// serializeGraph
// ---------------------------------------------------------------------------
describe('serializeGraph', () => {
  it('produces valid JSON with a links key', () => {
    const g: KnowledgeGraph = {
      nodes: [makeNode({ id: 'a' })],
      edges: [makeEdge({ source: 'a', target: 'a' })],
    };
    const json = serializeGraph(g);
    const parsed = JSON.parse(json);

    expect(parsed.links).toBeDefined();
    expect(Array.isArray(parsed.links)).toBe(true);
    expect(parsed.links).toHaveLength(1);
  });

  it('adds a builtAt timestamp when not present', () => {
    const g: KnowledgeGraph = {
      nodes: [makeNode({ id: 'a' })],
      edges: [],
    };
    const json = serializeGraph(g);
    const parsed = JSON.parse(json);

    expect(typeof parsed.builtAt).toBe('string');
    expect(() => new Date(parsed.builtAt)).not.toThrow();
  });

  it('adds stats when not present', () => {
    const g: KnowledgeGraph = {
      nodes: [makeNode({ id: 'a' })],
      edges: [makeEdge({ source: 'a', target: 'a' })],
    };
    const json = serializeGraph(g);
    const parsed = JSON.parse(json);

    expect(parsed.stats).toBeDefined();
    expect(parsed.stats.nodeCount).toBe(1);
    expect(parsed.stats.edgeCount).toBe(1);
  });

  it('preserves existing builtAt and stats when provided', () => {
    const g: KnowledgeGraph = {
      nodes: [makeNode({ id: 'a' })],
      edges: [],
      builtAt: '2024-06-01T12:00:00.000Z',
      builtAtCommit: 'abc123',
      stats: makeStats({ nodeCount: 42 }),
    };
    const json = serializeGraph(g);
    const parsed = JSON.parse(json);

    expect(parsed.builtAt).toBe('2024-06-01T12:00:00.000Z');
    expect(parsed.builtAtCommit).toBe('abc123');
    expect(parsed.stats.nodeCount).toBe(42);
  });

  it('includes directed and multigraph top-level fields', () => {
    const g: KnowledgeGraph = {
      nodes: [makeNode({ id: 'a' })],
      edges: [],
    };
    const json = serializeGraph(g);
    const parsed = JSON.parse(json);

    expect(parsed.directed).toBe(true);
    expect(parsed.multigraph).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deserializeGraph
// ---------------------------------------------------------------------------
describe('deserializeGraph', () => {
  it('roundtrips: serialize then deserialize produces an equivalent graph', () => {
    const g: KnowledgeGraph = {
      nodes: [
        makeNode({ id: 'a', community: 1, communityName: 'core', normLabel: 'a', degree: 3 }),
        makeNode({ id: 'b', sourceFile: 'src/b.ts', fileType: 'document' }),
      ],
      edges: [
        { ...makeEdge({ source: 'a', target: 'b', weight: 1.5, context: 'test', metadata: { foo: 'bar' } }) },
      ],
      hyperedges: [],
      builtAtCommit: 'abc123',
      builtAt: '2024-01-01T00:00:00.000Z',
      stats: makeStats({ nodeCount: 2, edgeCount: 1, communityCount: 1, extractedEdges: 1, fileCount: 2 }),
    };
    const json = serializeGraph(g);
    const deserialized = deserializeGraph(json);

    expect(deserialized.nodes).toHaveLength(2);
    expect(deserialized.nodes[0].id).toBe('a');
    expect(deserialized.nodes[0].community).toBe(1);
    expect(deserialized.nodes[1].fileType).toBe('document');
    expect(deserialized.edges).toHaveLength(1);
    expect(deserialized.edges[0].weight).toBe(1.5);
    expect(deserialized.edges[0].metadata).toEqual({ foo: 'bar' });
    expect(deserialized.builtAtCommit).toBe('abc123');
    expect(deserialized.builtAt).toBe('2024-01-01T00:00:00.000Z');
    expect(deserialized.stats).toEqual(g.stats);
  });

  it('handles old format with an edges key instead of links', () => {
    const oldFormat = JSON.stringify({
      nodes: [
        { id: 'a', label: 'A', sourceFile: 'src/index.ts', fileType: 'code' },
      ],
      edges: [
        { source: 'a', target: 'a', relation: 'imports', confidence: 'EXTRACTED' },
      ],
    });
    const g = deserializeGraph(oldFormat);

    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].id).toBe('a');
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].source).toBe('a');
  });

  it('rejects invalid JSON', () => {
    expect(() => deserializeGraph('{{')).toThrow('Failed to parse graph JSON');
  });

  it('rejects empty strings', () => {
    expect(() => deserializeGraph('')).toThrow('Cannot deserialize empty JSON string');
  });

  it('rejects JSON that is not an object', () => {
    expect(() => deserializeGraph('null')).toThrow('root must be an object');
    expect(() => deserializeGraph('"hello"')).toThrow('root must be an object');
  });

  it('rejects missing required node fields', () => {
    const bad = JSON.stringify({
      nodes: [{ label: 'OnlyLabel', sourceFile: 'src/x.ts' }],
      links: [],
    });
    expect(() => deserializeGraph(bad)).toThrow('missing required fields');
  });

  it('rejects missing required edge fields', () => {
    const bad = JSON.stringify({
      nodes: [{ id: 'a', label: 'A', sourceFile: 'src/x.ts' }],
      links: [{ source: 'a' }],
    });
    expect(() => deserializeGraph(bad)).toThrow('missing required fields');
  });

  it('rejects when nodes is not an array', () => {
    expect(() => deserializeGraph(JSON.stringify({ nodes: 'not-array' }))).toThrow(
      'must contain a "nodes" array',
    );
  });

  it('rejects when links/edges is not an array', () => {
    const bad = JSON.stringify({
      nodes: [{ id: 'a', label: 'A', sourceFile: 'src/x.ts' }],
      links: 'not-array',
    });
    expect(() => deserializeGraph(bad)).toThrow('must be an array');
  });
});

// ---------------------------------------------------------------------------
// computeStats
// ---------------------------------------------------------------------------
describe('computeStats', () => {
  it('correctly counts nodes and edges', () => {
    const stats = computeStats(
      [makeNode({ id: 'a' }), makeNode({ id: 'b' })],
      [makeEdge({ source: 'a', target: 'b' })],
    );

    expect(stats.nodeCount).toBe(2);
    expect(stats.edgeCount).toBe(1);
  });

  it('counts unique communities correctly', () => {
    const stats = computeStats(
      [
        makeNode({ id: 'a', community: 0 }),
        makeNode({ id: 'b', community: 0 }),
        makeNode({ id: 'c', community: 1 }),
        makeNode({ id: 'd' }),
      ],
      [],
    );

    expect(stats.communityCount).toBe(2);
  });

  it('breaks down edges by confidence level', () => {
    const stats = computeStats(
      [],
      [
        makeEdge({ source: 'a', target: 'b', confidence: 'EXTRACTED' }),
        makeEdge({ source: 'c', target: 'd', confidence: 'EXTRACTED' }),
        makeEdge({ source: 'e', target: 'f', confidence: 'INFERRED' }),
        makeEdge({ source: 'g', target: 'h', confidence: 'AMBIGUOUS' }),
      ],
    );

    expect(stats.extractedEdges).toBe(2);
    expect(stats.inferredEdges).toBe(1);
    expect(stats.ambiguousEdges).toBe(1);
  });

  it('counts unique source files', () => {
    const stats = computeStats(
      [
        makeNode({ id: 'a', sourceFile: 'src/a.ts' }),
        makeNode({ id: 'b', sourceFile: 'src/a.ts' }),
        makeNode({ id: 'c', sourceFile: 'src/c.ts' }),
        makeNode({ id: 'd', sourceFile: '' }),
      ],
      [],
    );

    expect(stats.fileCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// deduplicateNodes
// ---------------------------------------------------------------------------
describe('deduplicateNodes', () => {
  it('merges two nodes with the same ID', () => {
    const nodes = [
      makeNode({ id: 'dup', label: 'first', metadata: { x: 1 } }),
      makeNode({ id: 'dup', label: 'second', metadata: { y: 2 } }),
    ];
    const result = deduplicateNodes(nodes);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('second');
    expect(result[0].metadata).toEqual({ x: 1, y: 2 });
  });

  it('AST nodes win over non-AST nodes with the same ID', () => {
    const nodes = [
      makeNode({ id: 'dup', label: 'non-ast', metadata: { extra: true } }),
      makeNode({ id: 'dup', label: 'ast-winner', metadata: { _origin: 'ast' } }),
    ];
    const result = deduplicateNodes(nodes);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('ast-winner');
    expect(result[0].metadata?._origin).toBe('ast');
    expect(result[0].metadata?.extra).toBeUndefined();
  });

  it('returns nodes unchanged when all IDs are unique', () => {
    const nodes = [
      makeNode({ id: 'a' }),
      makeNode({ id: 'b' }),
      makeNode({ id: 'c' }),
    ];
    const result = deduplicateNodes(nodes);

    expect(result).toHaveLength(3);
    expect(result.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty array', () => {
    expect(deduplicateNodes([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeGraphs
// ---------------------------------------------------------------------------
describe('mergeGraphs', () => {
  it('merges two graphs with prefixed IDs', () => {
    const g1: KnowledgeGraph = {
      nodes: [makeNode({ id: 'a' })],
      edges: [],
    };
    const g2: KnowledgeGraph = {
      nodes: [makeNode({ id: 'a' }), makeNode({ id: 'b' })],
      edges: [],
    };
    const merged = mergeGraphs([g1, g2]);

    expect(merged.nodes).toHaveLength(3);
    expect(merged.nodes[0].id).toBe('g0_a');
    expect(merged.nodes[1].id).toBe('g1_a');
    expect(merged.nodes[2].id).toBe('g1_b');
  });

  it('preserves edges with remapped source and target IDs', () => {
    const g1: KnowledgeGraph = {
      nodes: [makeNode({ id: 'src' }), makeNode({ id: 'tgt' })],
      edges: [makeEdge({ source: 'src', target: 'tgt', relation: 'imports' })],
    };
    const merged = mergeGraphs([g1]);

    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0].source).toBe('g0_src');
    expect(merged.edges[0].target).toBe('g0_tgt');
    expect(merged.edges[0].relation).toBe('imports');
  });

  it('correctly processes a single graph', () => {
    const g1: KnowledgeGraph = {
      nodes: [makeNode({ id: 'a' })],
      edges: [makeEdge({ source: 'a', target: 'a' })],
    };
    const merged = mergeGraphs([g1]);

    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0].id).toBe('g0_a');
    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0].source).toBe('g0_a');
    expect(merged.edges[0].target).toBe('g0_a');
  });

  it('computes stats for the merged graph', () => {
    const g1: KnowledgeGraph = {
      nodes: [makeNode({ id: 'a' }), makeNode({ id: 'b' })],
      edges: [makeEdge({ source: 'a', target: 'b' })],
    };
    const merged = mergeGraphs([g1]);

    expect(merged.stats).toBeDefined();
    expect(merged.stats?.nodeCount).toBe(2);
    expect(merged.stats?.edgeCount).toBe(1);
  });
});
