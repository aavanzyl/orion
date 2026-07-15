import type {
  KnowledgeGraph,
  GodNode,
  SurprisingConnection,
  GraphNode,
  GraphEdge,
} from '@orion/models';
import { getCommunities, computeCohesion } from './cluster.js';

const JSON_KEY_LABELS = new Set([
  'id',
  'name',
  'type',
  'properties',
  'start',
  'end',
  'value',
  'key',
  'data',
  'node',
  'edge',
  'source',
  'target',
]);

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

function isFileNode(node: GraphNode): boolean {
  return node.label === basename(node.sourceFile);
}

function isBuiltinNoise(node: GraphNode): boolean {
  return JSON_KEY_LABELS.has(node.label);
}

function isConceptNode(node: GraphNode): boolean {
  return node.sourceFile === '';
}

function isNoise(node: GraphNode): boolean {
  return isFileNode(node) || isBuiltinNoise(node) || isConceptNode(node);
}

export function findGodNodes(graph: KnowledgeGraph, topN?: number): GodNode[] {
  const n = topN ?? 10;

  const candidates = graph.nodes
    .filter((node) => !isNoise(node))
    .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));

  return candidates.slice(0, n).map((node) => ({
    nodeId: node.id,
    label: node.label,
    degree: node.degree ?? 0,
    sourceFile: node.sourceFile,
    fileType: node.fileType,
  }));
}

export function findSurprisingConnections(
  graph: KnowledgeGraph,
  topN?: number,
): SurprisingConnection[] {
  const n = topN ?? 10;

  const nodeMap = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }

  const degreeMap = new Map<string, number>();
  for (const node of graph.nodes) {
    degreeMap.set(node.id, node.degree ?? 0);
  }

  const results: SurprisingConnection[] = [];

  for (const edge of graph.edges) {
    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);
    if (!src || !tgt) continue;

    if (src.sourceFile === tgt.sourceFile) continue;

    let score = 0;
    const reasons: string[] = [];

    let confBonus = 0;
    switch (edge.confidence) {
      case 'AMBIGUOUS':
        confBonus = 3;
        reasons.push('ambiguous confidence');
        break;
      case 'INFERRED':
        confBonus = 2;
        reasons.push('inferred confidence');
        break;
      case 'EXTRACTED':
        confBonus = 1;
        break;
    }
    score += confBonus;

    if (src.fileType !== tgt.fileType) {
      score += 2;
      reasons.push('cross-file-type');
    }

    if (src.community !== undefined && tgt.community !== undefined && src.community !== tgt.community) {
      score += 1;
      reasons.push('cross-community');
    }

    const srcDeg = degreeMap.get(src.id) ?? 0;
    const tgtDeg = degreeMap.get(tgt.id) ?? 0;
    if ((srcDeg <= 2 && tgtDeg >= 5) || (tgtDeg <= 2 && srcDeg >= 5)) {
      score += 1;
      reasons.push('peripheral-to-hub');
    }

    if (score > 0) {
      results.push({
        source: edge.source,
        sourceLabel: src.label,
        target: edge.target,
        targetLabel: tgt.label,
        relation: edge.relation,
        confidence: edge.confidence,
        score,
        why: reasons.join(', '),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, n);
}

function findAmbiguousEdges(graph: KnowledgeGraph): GraphEdge[] {
  return graph.edges.filter((e) => e.confidence === 'AMBIGUOUS');
}

function computeBridgeScore(
  nodeId: string,
  graph: KnowledgeGraph,
): { score: number; communities: Set<number> } {
  const communities = new Set<number>();
  const node = graph.nodes.find((n) => n.id === nodeId);

  for (const e of graph.edges) {
    if (e.source === nodeId || e.target === nodeId) {
      const otherId = e.source === nodeId ? e.target : e.source;
      const other = graph.nodes.find((n) => n.id === otherId);
      if (other?.community !== undefined && node?.community !== undefined && other.community !== node.community) {
        communities.add(other.community);
      }
    }
  }

  return { score: communities.size, communities };
}

export function findBridgeNodes(
  graph: KnowledgeGraph,
  topN?: number,
): GodNode[] {
  const n = topN ?? 10;

  const candidates: Array<{
    node: GraphNode;
    score: number;
  }> = [];

  for (const node of graph.nodes) {
    if (isNoise(node)) continue;
    const { score } = computeBridgeScore(node.id, graph);
    if (score > 0) {
      candidates.push({ node, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, n).map((c) => ({
    nodeId: c.node.id,
    label: c.node.label,
    degree: c.node.degree ?? 0,
    sourceFile: c.node.sourceFile,
    fileType: c.node.fileType,
  }));
}

export function findImportCycles(graph: KnowledgeGraph): string[][] {
  const importEdges = graph.edges.filter(
    (e) => e.relation === 'imports' || e.relation === 'imports_from',
  );

  const adj = new Map<string, Set<string>>();
  for (const e of importEdges) {
    let neighbors = adj.get(e.source);
    if (!neighbors) {
      neighbors = new Set();
      adj.set(e.source, neighbors);
    }
    neighbors.add(e.target);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[][] = [];

  function dfs(node: string, stack: string[]) {
    color.set(node, GRAY);
    stack.push(node);

    const neighbors = adj.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        const c = color.get(neighbor) ?? WHITE;
        if (c === GRAY) {
          const cycleStart = stack.indexOf(neighbor);
          if (cycleStart >= 0) {
            cycles.push(stack.slice(cycleStart));
          }
        } else if (c === WHITE) {
          dfs(neighbor, stack);
        }
      }
    }

    stack.pop();
    color.set(node, BLACK);
  }

  for (const node of adj.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      dfs(node, []);
    }
  }

  return cycles;
}

export function findIsolatedNodes(graph: KnowledgeGraph): string[] {
  const result: string[] = [];

  for (const node of graph.nodes) {
    const deg = node.degree ?? 0;
    if (deg <= 1) {
      result.push(node.id);
    }
  }

  return result;
}

export function suggestQuestions(
  graph: KnowledgeGraph,
  count?: number,
): string[] {
  const max = count ?? 10;
  const questions: string[] = [];
  const nodeMap = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    nodeMap.set(n.id, n);
  }

  const ambiguousEdges = findAmbiguousEdges(graph);
  for (const e of ambiguousEdges.slice(0, Math.ceil(max / 4))) {
    const src = nodeMap.get(e.source);
    const tgt = nodeMap.get(e.target);
    if (src && tgt) {
      questions.push(
        `What is the exact relationship between ${src.label} and ${tgt.label}?`,
      );
    }
  }

  const bridges = findBridgeNodes(graph, Math.ceil(max / 4));
  for (const b of bridges) {
    const { communities } = computeBridgeScore(b.nodeId, graph);
    const commArr = Array.from(communities);
    if (commArr.length >= 2) {
      questions.push(
        `Why does ${b.label} connect community ${commArr[0]} to community ${commArr[1]}?`,
      );
    }
  }

  const isolated = findIsolatedNodes(graph);
  for (const id of isolated.slice(0, Math.ceil(max / 4))) {
    const node = nodeMap.get(id);
    if (node && !isNoise(node)) {
      questions.push(`What connects ${node.label} to the rest of the system?`);
    }
  }

  const cohesion = computeCohesion(graph);

  const communities = getCommunities(graph);
  for (const comm of communities) {
    if ((cohesion.get(comm.id) ?? 1) < 0.3) {
      questions.push(`Should ${comm.label} be split into smaller modules?`);
    }
    if (questions.length >= max) break;
  }

  return questions.slice(0, max);
}
