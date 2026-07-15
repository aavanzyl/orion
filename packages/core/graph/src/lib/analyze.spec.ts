import { describe, it, expect } from 'vitest';
import {
  findGodNodes,
  findSurprisingConnections,
  suggestQuestions,
  findBridgeNodes,
  findIsolatedNodes,
  findImportCycles,
} from './analyze.js';
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
} from '@orion/models';

function createAnalyzeGraph(): KnowledgeGraph {
  const nodes: GraphNode[] = [
    { id: 'n1', label: 'authenticate', fileType: 'code', sourceFile: 'src/auth.ts', degree: 5, community: 0 },
    { id: 'n2', label: 'validateToken', fileType: 'code', sourceFile: 'src/auth.ts', degree: 2, community: 0 },
    { id: 'n3', label: 'hashPassword', fileType: 'code', sourceFile: 'src/auth.ts', degree: 1, community: 0 },
    { id: 'authFile', label: 'auth.ts', fileType: 'code', sourceFile: 'src/auth.ts', degree: 12, community: 0 },
    { id: 'n4', label: 'connect', fileType: 'code', sourceFile: 'src/database.ts', degree: 5, community: 1 },
    { id: 'n5', label: 'query', fileType: 'code', sourceFile: 'src/database.ts', degree: 2, community: 1 },
    { id: 'dbFile', label: 'database.ts', fileType: 'code', sourceFile: 'src/database.ts', degree: 9, community: 1 },
    { id: 'n6', label: 'parseJSON', fileType: 'code', sourceFile: 'src/utils.ts', degree: 2, community: 2 },
    { id: 'n7', label: 'formatDate', fileType: 'code', sourceFile: 'src/utils.ts', degree: 1, community: 2 },
    { id: 'utilsFile', label: 'utils.ts', fileType: 'code', sourceFile: 'src/utils.ts', degree: 7, community: 2 },
    { id: 'bridge', label: 'sharedHelper', fileType: 'code', sourceFile: 'src/shared.ts', degree: 4, community: 0 },
    { id: 'doc', label: 'README', fileType: 'document', sourceFile: 'README.md', degree: 1, community: 0 },
    { id: 'peripheral', label: 'peripheralUtil', fileType: 'code', sourceFile: 'src/peripheral.ts', degree: 1, community: 0 },
    { id: 'builtin', label: 'id', fileType: 'code', sourceFile: 'src/data.ts', degree: 6 },
    { id: 'concept', label: 'globalConfig', fileType: 'concept', sourceFile: '', degree: 3 },
    { id: 'orphan', label: 'orphanFunc', fileType: 'code', sourceFile: 'src/orphan.ts', degree: 0 },
    { id: 'dangle', label: 'dangleFunc', fileType: 'code', sourceFile: 'src/dangle.ts', degree: 1 },
    { id: 'modA', label: 'ModuleA', fileType: 'code', sourceFile: 'src/moduleA.ts', degree: 2, community: 0 },
    { id: 'modB', label: 'ModuleB', fileType: 'code', sourceFile: 'src/moduleB.ts', degree: 2, community: 0 },
    { id: 'modC', label: 'ModuleC', fileType: 'code', sourceFile: 'src/moduleC.ts', degree: 2, community: 0 },
  ];

  const edges: GraphEdge[] = [
    { source: 'n1', target: 'n2', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 'n1', target: 'n3', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 'n1', target: 'n4', relation: 'calls', confidence: 'AMBIGUOUS' },
    { source: 'n4', target: 'n5', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 'n5', target: 'n6', relation: 'calls', confidence: 'INFERRED' },
    { source: 'n6', target: 'n7', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 'bridge', target: 'n1', relation: 'calls', confidence: 'EXTRACTED' },
    { source: 'bridge', target: 'n4', relation: 'uses', confidence: 'INFERRED' },
    { source: 'bridge', target: 'n6', relation: 'uses', confidence: 'INFERRED' },
    { source: 'doc', target: 'n1', relation: 'references', confidence: 'EXTRACTED' },
    { source: 'peripheral', target: 'n1', relation: 'uses', confidence: 'AMBIGUOUS' },
    { source: 'modA', target: 'modB', relation: 'imports', confidence: 'EXTRACTED' },
    { source: 'modB', target: 'modC', relation: 'imports', confidence: 'EXTRACTED' },
    { source: 'modC', target: 'modA', relation: 'imports', confidence: 'EXTRACTED' },
  ];

  return { nodes, edges };
}

describe('findGodNodes', () => {
  const graph = createAnalyzeGraph();

  it('returns highest-degree nodes sorted by degree', () => {
    const result = findGodNodes(graph);
    expect(result.length).toBeGreaterThan(0);

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].degree).toBeGreaterThanOrEqual(result[i].degree);
    }
  });

  it('includes non-noise nodes with high degree', () => {
    const result = findGodNodes(graph, 5);
    const ids = result.map((g) => g.nodeId);
    expect(ids).toContain('n1');
    expect(ids).toContain('n4');
  });

  it('respects topN parameter', () => {
    const result = findGodNodes(graph, 2);
    expect(result).toHaveLength(2);
  });

  it('filters out file-level hub nodes', () => {
    const result = findGodNodes(graph, 20);
    const labels = result.map((g) => g.label);

    expect(labels).not.toContain('auth.ts');
    expect(labels).not.toContain('database.ts');
    expect(labels).not.toContain('utils.ts');
  });

  it('filters out builtin noise nodes', () => {
    const result = findGodNodes(graph, 20);
    const labels = result.map((g) => g.label);
    expect(labels).not.toContain('id');
  });

  it('filters out concept nodes', () => {
    const result = findGodNodes(graph, 20);
    const labels = result.map((g) => g.label);
    expect(labels).not.toContain('globalConfig');
  });

  it('handles empty graph', () => {
    const result = findGodNodes({ nodes: [], edges: [] });
    expect(result).toEqual([]);
  });

  it('returns empty array when graph has only file nodes', () => {
    const fileOnlyGraph: KnowledgeGraph = {
      nodes: [
        { id: 'f1', label: 'a.ts', fileType: 'code', sourceFile: 'src/a.ts', degree: 10 },
        { id: 'f2', label: 'b.ts', fileType: 'code', sourceFile: 'src/b.ts', degree: 5 },
      ],
      edges: [],
    };
    const result = findGodNodes(fileOnlyGraph);
    expect(result).toEqual([]);
  });
});

describe('findSurprisingConnections', () => {
  const graph = createAnalyzeGraph();

  it('finds cross-community edges as surprising', () => {
    const result = findSurprisingConnections(graph, 20);
    const hasCrossCommunity = result.some((c) => c.why.includes('cross-community'));
    expect(hasCrossCommunity).toBe(true);
  });

  it('AMBIGUOUS edges score higher than EXTRACTED edges', () => {
    const result = findSurprisingConnections(graph, 20);
    const ambiguousEdges = result.filter((c) => c.confidence === 'AMBIGUOUS');
    const extractedEdges = result.filter((c) => c.confidence === 'EXTRACTED');

    if (ambiguousEdges.length > 0 && extractedEdges.length > 0) {
      const maxAmbiguous = Math.max(...ambiguousEdges.map((c) => c.score));
      const maxExtracted = Math.max(...extractedEdges.map((c) => c.score));
      expect(maxAmbiguous).toBeGreaterThanOrEqual(maxExtracted);
    }
  });

  it('returns limited number when topN specified', () => {
    const result = findSurprisingConnections(graph, 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('each result has required fields', () => {
    const result = findSurprisingConnections(graph);
    for (const conn of result) {
      expect(conn.source).toBeTruthy();
      expect(conn.target).toBeTruthy();
      expect(conn.sourceLabel).toBeTruthy();
      expect(conn.targetLabel).toBeTruthy();
      expect(conn.relation).toBeTruthy();
      expect(conn.confidence).toBeTruthy();
      expect(conn.score).toBeGreaterThan(0);
    }
  });

  it('handles graph with no cross-community edges', () => {
    const singleCommunityGraph: KnowledgeGraph = {
      nodes: [
        { id: 'a', label: 'A', fileType: 'code', sourceFile: 'src/shared.ts', degree: 2, community: 0 },
        { id: 'b', label: 'B', fileType: 'code', sourceFile: 'src/shared.ts', degree: 1, community: 0 },
      ],
      edges: [
        { source: 'a', target: 'b', relation: 'calls', confidence: 'EXTRACTED' },
      ],
    };

    const result = findSurprisingConnections(singleCommunityGraph);
    expect(result).toEqual([]);
  });

  it('detects peripheral-to-hub connections', () => {
    const result = findSurprisingConnections(graph, 20);
    const hasPeripheralToHub = result.some((c) => c.why.includes('peripheral-to-hub'));
    expect(hasPeripheralToHub).toBe(true);
  });
});

describe('suggestQuestions', () => {
  const graph = createAnalyzeGraph();

  it('generates questions when there are ambiguous edges', () => {
    const questions = suggestQuestions(graph, 20);
    const hasAmbiguousQuestion = questions.some((q) =>
      q.startsWith('What is the exact relationship between'),
    );
    expect(hasAmbiguousQuestion).toBe(true);
  });

  it('generates questions when there are isolated nodes', () => {
    const questions = suggestQuestions(graph, 20);
    const hasIsolatedQuestion = questions.some((q) =>
      q.includes('What connects') && q.includes('rest of the system'),
    );
    expect(hasIsolatedQuestion).toBe(true);
  });

  it('each question is a non-empty string', () => {
    const questions = suggestQuestions(graph, 20);
    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) {
      expect(typeof q).toBe('string');
      expect(q.length).toBeGreaterThan(0);
    }
  });

  it('respects count limit', () => {
    const questions = suggestQuestions(graph, 3);
    expect(questions.length).toBeLessThanOrEqual(3);
  });

  it('returns empty array for empty graph', () => {
    const questions = suggestQuestions({ nodes: [], edges: [] });
    expect(questions).toEqual([]);
  });

  it('generates distinct questions', () => {
    const questions = suggestQuestions(graph, 20);
    const unique = new Set(questions);
    expect(unique.size).toBe(questions.length);
  });
});

describe('findBridgeNodes', () => {
  const graph = createAnalyzeGraph();

  it('identifies nodes connecting different communities', () => {
    const result = findBridgeNodes(graph, 20);
    const ids = result.map((b) => b.nodeId);
    expect(ids).toContain('bridge');
  });

  it('bridge nodes have high betweenness score', () => {
    const result = findBridgeNodes(graph, 20);
    expect(result.length).toBeGreaterThan(0);

    for (const bridge of result) {
      expect(bridge.degree).toBeGreaterThan(0);
    }
  });

  it('ranks by betweenness centrality', () => {
    const result = findBridgeNodes(graph, 20);

    expect(result.length).toBeGreaterThanOrEqual(2);

    const bridgeEntry = result.find((b) => b.nodeId === 'bridge');
    expect(bridgeEntry).toBeDefined();
    expect(bridgeEntry!.degree).toBe(4);

    const ids = result.map((b) => b.nodeId);
    expect(ids).toContain('n6');
  });

  it('filters out noise nodes', () => {
    const result = findBridgeNodes(graph, 20);
    const labels = result.map((b) => b.label);
    expect(labels).not.toContain('id');
    expect(labels).not.toContain('globalConfig');
  });

  it('handles empty graph', () => {
    const result = findBridgeNodes({ nodes: [], edges: [] });
    expect(result).toEqual([]);
  });

  it('returns empty when no cross-community edges exist', () => {
    const singleGraph: KnowledgeGraph = {
      nodes: [
        { id: 'x', label: 'X', fileType: 'code', sourceFile: 'src/x.ts', degree: 2, community: 0 },
        { id: 'y', label: 'Y', fileType: 'code', sourceFile: 'src/y.ts', degree: 1, community: 0 },
      ],
      edges: [
        { source: 'x', target: 'y', relation: 'calls', confidence: 'EXTRACTED' },
      ],
    };
    const result = findBridgeNodes(singleGraph);
    expect(result).toEqual([]);
  });
});

describe('findIsolatedNodes', () => {
  const graph = createAnalyzeGraph();

  it('returns nodes with degree <= 1', () => {
    const result = findIsolatedNodes(graph);

    expect(result).toContain('orphan');
    expect(result).toContain('dangle');
    expect(result).toContain('n3');
  });

  it('does not include well-connected nodes', () => {
    const result = findIsolatedNodes(graph);
    expect(result).not.toContain('n1');
    expect(result).not.toContain('n4');
    expect(result).not.toContain('bridge');
  });

  it('handles graph with no isolated nodes', () => {
    const connectedGraph: KnowledgeGraph = {
      nodes: [
        { id: 'a', label: 'A', fileType: 'code', sourceFile: 'src/a.ts', degree: 3 },
        { id: 'b', label: 'B', fileType: 'code', sourceFile: 'src/b.ts', degree: 3 },
      ],
      edges: [
        { source: 'a', target: 'b', relation: 'calls', confidence: 'EXTRACTED' },
      ],
    };
    const result = findIsolatedNodes(connectedGraph);
    expect(result).toEqual([]);
  });

  it('handles graph where all nodes are isolated', () => {
    const allIsolated: KnowledgeGraph = {
      nodes: [
        { id: 'a', label: 'A', fileType: 'code', sourceFile: 'src/a.ts', degree: 0 },
        { id: 'b', label: 'B', fileType: 'code', sourceFile: 'src/b.ts', degree: 0 },
      ],
      edges: [],
    };
    const result = findIsolatedNodes(allIsolated);
    expect(result).toEqual(['a', 'b']);
  });

  it('handles empty graph', () => {
    const result = findIsolatedNodes({ nodes: [], edges: [] });
    expect(result).toEqual([]);
  });
});

describe('findImportCycles', () => {
  const graph = createAnalyzeGraph();

  it('detects simple import cycles', () => {
    const cycles = findImportCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);

    const cycleWithA = cycles.find((c) => c.includes('modA'));
    expect(cycleWithA).toBeDefined();
  });

  it('returns empty for acyclic graph', () => {
    const acyclicGraph: KnowledgeGraph = {
      nodes: [
        { id: 'x', label: 'X', fileType: 'code', sourceFile: 'src/x.ts', degree: 1 },
        { id: 'y', label: 'Y', fileType: 'code', sourceFile: 'src/y.ts', degree: 1 },
      ],
      edges: [
        { source: 'x', target: 'y', relation: 'imports', confidence: 'EXTRACTED' },
      ],
    };
    const result = findImportCycles(acyclicGraph);
    expect(result).toEqual([]);
  });

  it('ignores non-import edges for cycle detection', () => {
    const callsOnlyGraph: KnowledgeGraph = {
      nodes: [
        { id: 'a', label: 'A', fileType: 'code', sourceFile: 'src/a.ts', degree: 2 },
        { id: 'b', label: 'B', fileType: 'code', sourceFile: 'src/b.ts', degree: 2 },
        { id: 'c', label: 'C', fileType: 'code', sourceFile: 'src/c.ts', degree: 2 },
      ],
      edges: [
        { source: 'a', target: 'b', relation: 'calls', confidence: 'EXTRACTED' },
        { source: 'b', target: 'c', relation: 'calls', confidence: 'EXTRACTED' },
        { source: 'c', target: 'a', relation: 'calls', confidence: 'EXTRACTED' },
      ],
    };
    const cycles = findImportCycles(callsOnlyGraph);
    expect(cycles).toEqual([]);
  });

  it('handles empty graph', () => {
    const result = findImportCycles({ nodes: [], edges: [] });
    expect(result).toEqual([]);
  });
});
