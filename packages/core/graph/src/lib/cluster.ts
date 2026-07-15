import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  GraphCommunity,
} from '@orion/models';

export interface ClusterOptions {
  resolution?: number;
  randomSeed?: number;
  maxIterations?: number;
  minCommunitySize?: number;
  excludeHubPercentile?: number;
}

const DEFAULT_RESOLUTION = 1.0;
const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_MIN_COMMUNITY_SIZE = 3;
const DEFAULT_EXCLUDE_HUB_PERCENTILE = 99;

function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

function fisherYatesShuffle<T>(arr: T[], rng: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function buildAdjacency(
  nodes: GraphNode[],
  edges: GraphEdge[],
): {
  neighbors: Map<string, Set<string>>;
  weights: Map<string, Map<string, number>>;
  degrees: Map<string, number>;
  totalWeight: number;
} {
  const neighbors = new Map<string, Set<string>>();
  const weights = new Map<string, Map<string, number>>();
  const degrees = new Map<string, number>();
  let totalWeight = 0;

  for (const n of nodes) {
    neighbors.set(n.id, new Set());
    weights.set(n.id, new Map());
    degrees.set(n.id, 0);
  }

  for (const e of edges) {
    const w = e.weight ?? 1.0;
    totalWeight += w;

    const srcSet = neighbors.get(e.source);
    const tgtSet = neighbors.get(e.target);
    if (srcSet && tgtSet) {
      srcSet.add(e.target);
      tgtSet.add(e.source);
    }

    const srcW = weights.get(e.source);
    const tgtW = weights.get(e.target);
    if (srcW && tgtW) {
      srcW.set(e.target, (srcW.get(e.target) ?? 0) + w);
      tgtW.set(e.source, (tgtW.get(e.source) ?? 0) + w);
    }

    degrees.set(e.source, (degrees.get(e.source) ?? 0) + w);
    degrees.set(e.target, (degrees.get(e.target) ?? 0) + w);
  }

  return { neighbors, weights, degrees, totalWeight };
}

function modularityGain(
  nodeId: string,
  targetCommunity: number,
  nodeToCommunity: Map<string, number>,
  communityInternalWeight: Map<number, number>,
  communityTotalDegree: Map<number, number>,
  weights: Map<string, Map<string, number>>,
  degrees: Map<string, number>,
  totalWeight: number,
): number {
  const k_i = degrees.get(nodeId) ?? 0;
  const sigma_in = communityInternalWeight.get(targetCommunity) ?? 0;
  const sigma_tot = communityTotalDegree.get(targetCommunity) ?? 0;

  const nodeWeights = weights.get(nodeId);
  let k_i_in = 0;
  if (nodeWeights) {
    for (const [neighborId, w] of nodeWeights) {
      if (nodeToCommunity.get(neighborId) === targetCommunity) {
        k_i_in += w;
      }
    }
  }

  const twoM = 2 * totalWeight;
  if (twoM === 0) return 0;

  const gain =
    (sigma_in + 2 * k_i_in) / twoM -
    ((sigma_tot + k_i) / twoM) * ((sigma_tot + k_i) / twoM) -
    (sigma_in / twoM -
      (sigma_tot / twoM) * (sigma_tot / twoM) -
      (k_i / twoM) * (k_i / twoM));

  return gain;
}

function computeCommunityStats(
  nodeToCommunity: Map<string, number>,
  edges: GraphEdge[],
  nodeIds: Set<string>,
): {
  internalWeight: Map<number, number>;
  totalDegree: Map<number, number>;
} {
  const internalWeight = new Map<number, number>();
  const totalDegree = new Map<number, number>();

  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;

    const srcComm = nodeToCommunity.get(e.source);
    const tgtComm = nodeToCommunity.get(e.target);
    const w = e.weight ?? 1.0;

    if (srcComm !== undefined) {
      totalDegree.set(srcComm, (totalDegree.get(srcComm) ?? 0) + w);
    }
    if (tgtComm !== undefined) {
      totalDegree.set(tgtComm, (totalDegree.get(tgtComm) ?? 0) + w);
    }

    if (srcComm !== undefined && srcComm === tgtComm) {
      internalWeight.set(srcComm, (internalWeight.get(srcComm) ?? 0) + w);
    }
  }

  return { internalWeight, totalDegree };
}

function computeHubThreshold(
  degrees: Map<string, number>,
  percentile: number,
): number {
  const vals = Array.from(degrees.values()).filter((d) => d > 0);
  if (vals.length === 0) return Infinity;
  vals.sort((a, b) => a - b);
  const idx = Math.floor((percentile / 100) * (vals.length - 1));
  return vals[idx];
}

export function detectCommunities(
  graph: KnowledgeGraph,
  opts?: ClusterOptions,
): KnowledgeGraph {
  const resolution = opts?.resolution ?? DEFAULT_RESOLUTION;
  const maxIterations = opts?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const minCommunitySize =
    opts?.minCommunitySize ?? DEFAULT_MIN_COMMUNITY_SIZE;
  const hubPercentile =
    opts?.excludeHubPercentile ?? DEFAULT_EXCLUDE_HUB_PERCENTILE;
  const rng = seededRandom(opts?.randomSeed ?? 42);

  const nodes = graph.nodes;
  const edges = graph.edges;

  if (nodes.length === 0) {
    return { ...graph, nodes: [], edges };
  }

  const { neighbors, weights, degrees, totalWeight } = buildAdjacency(
    nodes,
    edges,
  );

  const hubThreshold = computeHubThreshold(degrees, hubPercentile);
  const hubIds = new Set<string>();
  for (const [id, deg] of degrees) {
    if (deg > hubThreshold) {
      hubIds.add(id);
    }
  }

  const nonHubIds = nodes.map((n) => n.id).filter((id) => !hubIds.has(id));

  const nodeToCommunity = new Map<string, number>();
  let nextCommunityId = 0;
  for (const id of nonHubIds) {
    nodeToCommunity.set(id, nextCommunityId++);
  }

  const twoM = 2 * totalWeight;
  if (twoM === 0) {
    const resultNodes = nodes.map((n) => ({
      ...n,
      community: nodeToCommunity.get(n.id),
    }));
    return { ...graph, nodes: resultNodes };
  }

  const { internalWeight, totalDegree } = computeCommunityStats(
    nodeToCommunity,
    edges,
    new Set(nonHubIds),
  );

  const nodeList = nonHubIds;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let moved = false;
    const shuffled = fisherYatesShuffle(nodeList, rng);

    for (const nodeId of shuffled) {
      const currentComm = nodeToCommunity.get(nodeId);
      if (currentComm === undefined) continue;

      const k_i = degrees.get(nodeId) ?? 0;
      const nodeWeights = weights.get(nodeId);

      if (!nodeWeights) continue;

      if (k_i > 0) {
        internalWeight.set(
          currentComm,
          (internalWeight.get(currentComm) ?? 0) - (nodeWeights.get(nodeId) ?? 0),
        );
        for (const [neighborId, w] of nodeWeights) {
          if (nodeToCommunity.get(neighborId) === currentComm) {
            internalWeight.set(
              currentComm,
              (internalWeight.get(currentComm) ?? 0) - w,
            );
          }
        }
      }
      totalDegree.set(currentComm, (totalDegree.get(currentComm) ?? 0) - k_i);

      let bestComm = currentComm;
      let bestGain = 0;

      const candidateComms = new Set<number>();
      const nodeNeighbors = neighbors.get(nodeId);
      if (nodeNeighbors) {
        for (const neighborId of nodeNeighbors) {
          const nc = nodeToCommunity.get(neighborId);
          if (nc !== undefined && nc !== currentComm) {
            candidateComms.add(nc);
          }
        }
      }

      for (const candidateComm of candidateComms) {
        const gain =
          modularityGain(
            nodeId,
            candidateComm,
            nodeToCommunity,
            internalWeight,
            totalDegree,
            weights,
            degrees,
            totalWeight,
          ) * resolution;

        if (gain > bestGain) {
          bestGain = gain;
          bestComm = candidateComm;
        }
      }

      nodeToCommunity.set(nodeId, bestComm);
      if (bestComm !== currentComm) moved = true;

      totalDegree.set(bestComm, (totalDegree.get(bestComm) ?? 0) + k_i);
      if (nodeWeights) {
        for (const [neighborId, w] of nodeWeights) {
          if (nodeToCommunity.get(neighborId) === bestComm) {
            internalWeight.set(
              bestComm,
              (internalWeight.get(bestComm) ?? 0) + w,
            );
          }
        }
      }
    }

    if (!moved) break;
  }

  const communitySizes = new Map<number, number>();
  for (const [, comm] of nodeToCommunity) {
    communitySizes.set(comm, (communitySizes.get(comm) ?? 0) + 1);
  }

  const smallCommunities = new Set<number>();
  for (const [comm, size] of communitySizes) {
    if (size < minCommunitySize) {
      smallCommunities.add(comm);
    }
  }

  if (smallCommunities.size > 0) {
    const largeCommunities = new Set<number>();
    for (const [comm] of communitySizes) {
      if (!smallCommunities.has(comm)) {
        largeCommunities.add(comm);
      }
    }

    for (const nodeId of nodeList) {
      const comm = nodeToCommunity.get(nodeId);
      if (comm !== undefined && smallCommunities.has(comm)) {
        const nodeNeighbors = neighbors.get(nodeId);
        if (!nodeNeighbors) continue;

        const neighborComms = new Map<number, number>();
        for (const neighborId of nodeNeighbors) {
          const nc = nodeToCommunity.get(neighborId);
          if (nc !== undefined && largeCommunities.has(nc)) {
            neighborComms.set(nc, (neighborComms.get(nc) ?? 0) + 1);
          }
        }

        if (neighborComms.size > 0) {
          let bestNeighborComm = -1;
          let bestCount = 0;
          for (const [nc, count] of neighborComms) {
            if (count > bestCount) {
              bestCount = count;
              bestNeighborComm = nc;
            }
          }
          if (bestNeighborComm >= 0) {
            nodeToCommunity.set(nodeId, bestNeighborComm);
          }
        }
      }
    }

    const reintegrated = new Set<number>();
    for (const [, comm] of nodeToCommunity) {
      if (!smallCommunities.has(comm)) {
        reintegrated.add(comm);
      }
    }

    const remainingSmall = new Set<number>();
    for (const [, comm] of nodeToCommunity) {
      if (smallCommunities.has(comm)) {
        remainingSmall.add(comm);
      }
    }

    let fallbackComm = 0;
    for (const [, comm] of nodeToCommunity) {
      if (!remainingSmall.has(comm)) {
        fallbackComm = comm;
        break;
      }
    }

    for (const nodeId of nodeList) {
      const comm = nodeToCommunity.get(nodeId);
      if (comm !== undefined && remainingSmall.has(comm)) {
        nodeToCommunity.set(nodeId, fallbackComm);
      }
    }
  }

  let commCounter = 0;
  const commRemap = new Map<number, number>();
  const normalizedCommunities = new Map<string, number>();

  for (const nodeId of nodeList) {
    const comm = nodeToCommunity.get(nodeId);
    if (comm === undefined) continue;
    let remapped = commRemap.get(comm);
    if (remapped === undefined) {
      remapped = commCounter++;
      commRemap.set(comm, remapped);
    }
    normalizedCommunities.set(nodeId, remapped);
  }

  for (const hubId of hubIds) {
    const hubNeighbors = neighbors.get(hubId);
    if (!hubNeighbors || hubNeighbors.size === 0) {
      normalizedCommunities.set(hubId, commCounter++);
      continue;
    }

    const commCounts = new Map<number, number>();
    for (const neighborId of hubNeighbors) {
      const nc = normalizedCommunities.get(neighborId);
      if (nc !== undefined) {
        commCounts.set(nc, (commCounts.get(nc) ?? 0) + 1);
      }
    }

    if (commCounts.size === 0) {
      normalizedCommunities.set(hubId, commCounter++);
      continue;
    }

    let bestComm = -1;
    let bestCount = 0;
    for (const [nc, count] of commCounts) {
      if (count > bestCount) {
        bestCount = count;
        bestComm = nc;
      }
    }
    normalizedCommunities.set(hubId, bestComm >= 0 ? bestComm : commCounter++);
  }

  const resultNodes = nodes.map((n) => ({
    ...n,
    community: normalizedCommunities.get(n.id),
  }));

  return { ...graph, nodes: resultNodes };
}

export function labelCommunities(graph: KnowledgeGraph): KnowledgeGraph {
  const communityNodes = new Map<number, GraphNode[]>();
  for (const n of graph.nodes) {
    if (n.community === undefined) continue;
    const comm = n.community;
    let arr = communityNodes.get(comm);
    if (!arr) {
      arr = [];
      communityNodes.set(comm, arr);
    }
    arr.push(n);
  }

  const communityLabel = new Map<number, string>();
  for (const [comm, nodes] of communityNodes) {
    let bestNode: GraphNode | null = null;
    let bestDegree = -1;
    for (const n of nodes) {
      const deg = n.degree ?? 0;
      if (deg > bestDegree) {
        bestDegree = deg;
        bestNode = n;
      }
    }
    communityLabel.set(comm, bestNode?.label ?? `community_${comm}`);
  }

  const resultNodes = graph.nodes.map((n) => {
    if (n.community === undefined) return n;
    return { ...n, communityName: communityLabel.get(n.community) };
  });

  return { ...graph, nodes: resultNodes };
}

export function getCommunities(graph: KnowledgeGraph): GraphCommunity[] {
  const communityMap = new Map<number, GraphCommunity>();

  for (const n of graph.nodes) {
    if (n.community === undefined) continue;
    const comm = n.community;
    let c = communityMap.get(comm);
    if (!c) {
      c = {
        id: comm,
        label: n.communityName ?? `community_${comm}`,
        size: 0,
        memberIds: [],
      };
      communityMap.set(comm, c);
    }
    c.size++;
    c.memberIds.push(n.id);
  }

  return Array.from(communityMap.values()).sort((a, b) => b.size - a.size);
}

export function computeCohesion(
  graph: KnowledgeGraph,
): Map<number, number> {
  const communities = getCommunities(graph);
  const communityNodeSets = new Map<number, Set<string>>();
  for (const c of communities) {
    communityNodeSets.set(c.id, new Set(c.memberIds));
  }

  const internalEdges = new Map<number, number>();
  const totalPossible = new Map<number, number>();

  for (const e of graph.edges) {
    const srcComm = graph.nodes.find((n) => n.id === e.source)?.community;
    const tgtComm = graph.nodes.find((n) => n.id === e.target)?.community;
    if (srcComm === undefined || tgtComm === undefined) continue;

    if (srcComm === tgtComm) {
      internalEdges.set(srcComm, (internalEdges.get(srcComm) ?? 0) + 1);
    }
  }

  for (const c of communities) {
    const n = c.size;
    totalPossible.set(c.id, n * (n - 1));
  }

  const cohesion = new Map<number, number>();
  for (const [comm, internal] of internalEdges) {
    const possible = totalPossible.get(comm) ?? 1;
    cohesion.set(comm, possible > 0 ? internal / possible : 0);
  }

  for (const c of communities) {
    if (!cohesion.has(c.id)) {
      cohesion.set(c.id, 0);
    }
  }

  return cohesion;
}
