import { describe, it, expect } from 'vitest';
import {
  detectCommunities,
  labelCommunities,
  getCommunities,
  computeCohesion,
} from './cluster.js';
import type { KnowledgeGraph, GraphNode, GraphEdge } from '@orion/models';

function makeNode(
  id: string,
  label?: string,
  degree?: number,
  extra?: Partial<GraphNode>,
): GraphNode {
  return {
    id,
    label: label ?? id,
    fileType: 'code',
    sourceFile: `src/${id}.ts`,
    degree,
    ...extra,
  };
}

function makeEdge(
  source: string,
  target: string,
  weight?: number,
  extra?: Partial<GraphEdge>,
): GraphEdge {
  return {
    source,
    target,
    relation: 'imports',
    confidence: 'EXTRACTED',
    weight: weight ?? 1.0,
    ...extra,
  };
}

function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): KnowledgeGraph {
  return { nodes, edges };
}

function makeChainGraph(nodeCount = 5): KnowledgeGraph {
  const ids = Array.from({ length: nodeCount }, (_, i) => String.fromCharCode(65 + i));
  const nodes = ids.map((id) => makeNode(id));
  const edges: GraphEdge[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    edges.push(makeEdge(ids[i], ids[i + 1]));
  }
  return makeGraph(nodes, edges);
}

function makeDisconnectedGraph(): KnowledgeGraph {
  const nodes = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => makeNode(id));
  const edges = [
    makeEdge('A', 'B'),
    makeEdge('B', 'C'),
    makeEdge('D', 'E'),
    makeEdge('E', 'F'),
  ];
  return makeGraph(nodes, edges);
}

describe('detectCommunities', () => {
  it('detects communities on a simple connected graph', () => {
    const result = detectCommunities(makeChainGraph());
    const communities = new Set(result.nodes.map((n) => n.community));
    expect(communities.size).toBeGreaterThanOrEqual(1);
  });

  it('detects multiple communities on a disconnected graph', () => {
    const result = detectCommunities(makeDisconnectedGraph());
    const communities = new Set(result.nodes.map((n) => n.community));
    expect(communities.size).toBeGreaterThanOrEqual(2);
  });

  it('assigns a community property to every node', () => {
    const result = detectCommunities(makeChainGraph());
    expect(result.nodes).toHaveLength(5);
    for (const node of result.nodes) {
      expect(node.community).toEqual(expect.any(Number));
    }
  });

  it('accepts different resolution values without error', () => {
    const graph = makeChainGraph();
    const low = detectCommunities(graph, { resolution: 0.01 });
    const high = detectCommunities(graph, { resolution: 100 });
    expect(low.nodes.every((n) => typeof n.community === 'number')).toBe(true);
    expect(high.nodes.every((n) => typeof n.community === 'number')).toBe(true);
  });

  it('handles an empty graph', () => {
    const result = detectCommunities({ nodes: [], edges: [] });
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('handles a single-node graph', () => {
    const result = detectCommunities({ nodes: [makeNode('A')], edges: [] });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].community).toEqual(expect.any(Number));
  });

  it('produces deterministic results with the same randomSeed', () => {
    const graph = makeChainGraph(8);
    const a = detectCommunities(graph, { randomSeed: 42 });
    const b = detectCommunities(graph, { randomSeed: 42 });
    const communitiesA = new Map(a.nodes.map((n) => [n.id, n.community]));
    const communitiesB = new Map(b.nodes.map((n) => [n.id, n.community]));
    expect(communitiesA).toEqual(communitiesB);
  });
});

describe('labelCommunities', () => {
  it('labels communities by highest-degree node', () => {
    const nodes = [
      makeNode('A', 'LowDegree', 1),
      makeNode('B', 'HighDegree', 10),
      makeNode('C', 'MediumDegree', 5),
    ];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C')];
    const clustered = detectCommunities(
      makeGraph(nodes, edges),
      { excludeHubPercentile: 100 },
    );
    const labeled = labelCommunities(clustered);
    const communities = getCommunities(labeled);
    for (const c of communities) {
      const highestDegreeNode = nodes
        .filter((n) => c.memberIds.includes(n.id))
        .reduce((max, n) => ((n.degree ?? 0) > (max.degree ?? 0) ? n : max));
      expect(c.label).toBe(highestDegreeNode.label);
    }
  });

  it('assigns communityName to every node that has a community', () => {
    const graph = makeChainGraph();
    const clustered = detectCommunities(graph);
    const labeled = labelCommunities(clustered);
    for (const node of labeled.nodes) {
      if (node.community !== undefined) {
        expect(node.communityName).toEqual(expect.any(String));
      }
    }
  });
});

describe('getCommunities', () => {
  it('returns communities with id, label, size, and memberIds', () => {
    const graph = makeDisconnectedGraph();
    const clustered = detectCommunities(graph);
    const labeled = labelCommunities(clustered);
    const communities = getCommunities(labeled);
    expect(communities.length).toBeGreaterThanOrEqual(1);
    for (const c of communities) {
      expect(typeof c.id).toBe('number');
      expect(typeof c.label).toBe('string');
      expect(typeof c.size).toBe('number');
      expect(Array.isArray(c.memberIds)).toBe(true);
    }
  });

  it('returns community sizes that sum to total node count', () => {
    const graph = makeDisconnectedGraph();
    const clustered = detectCommunities(graph);
    const labeled = labelCommunities(clustered);
    const communities = getCommunities(labeled);
    const totalSize = communities.reduce((sum, c) => sum + c.size, 0);
    expect(totalSize).toBe(graph.nodes.length);
  });

  it('returns memberIds that match each node community assignment', () => {
    const graph = makeDisconnectedGraph();
    const clustered = detectCommunities(graph);
    const labeled = labelCommunities(clustered);
    const communities = getCommunities(labeled);
    const allMemberIds = communities.flatMap((c) => c.memberIds);
    const allNodeIds = labeled.nodes.map((n) => n.id);
    expect(allMemberIds.sort()).toEqual(allNodeIds.sort());
    for (const c of communities) {
      for (const memberId of c.memberIds) {
        const node = labeled.nodes.find((n) => n.id === memberId);
        expect(node?.community).toBe(c.id);
      }
    }
  });
});

describe('computeCohesion', () => {
  it('returns cohesion scores between 0 and 1', () => {
    const graph = makeChainGraph();
    const clustered = detectCommunities(graph);
    const cohesion = computeCohesion(clustered);
    for (const [, score] of cohesion) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('returns cohesion near 1 for a fully connected community', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'A')];
    const graph = makeGraph(nodes, edges);
    const clustered = detectCommunities(graph);
    const cohesion = computeCohesion(clustered);
    for (const [, score] of cohesion) {
      expect(score).toBeCloseTo(1);
    }
  });

  it('returns low cohesion for a sparse community', () => {
    const graph = makeChainGraph();
    const nodesWithCommunity = graph.nodes.map((n) => ({
      ...n,
      community: 0,
    }));
    const modifiedGraph = { ...graph, nodes: nodesWithCommunity };
    const cohesion = computeCohesion(modifiedGraph);
    const score = cohesion.get(0) ?? 1;
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.5);
  });

  it('handles communities of size 1 by returning 0', () => {
    const nodes = [
      { ...makeNode('A'), community: 0 },
      { ...makeNode('B'), community: 1 },
    ];
    const graph = makeGraph(nodes, [makeEdge('A', 'B')]);
    const cohesion = computeCohesion(graph);
    expect(cohesion.get(0)).toBe(0);
    expect(cohesion.get(1)).toBe(0);
  });
});
