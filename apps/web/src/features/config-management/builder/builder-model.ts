import { parse, stringify } from 'yaml';
import type { Node, Edge } from '@xyflow/react';
import type { BudgetConfig, WorkflowConfig } from '@orion/models';
import {
  dataToNodeConfig,
  nodeConfigToData,
  validateNodeData,
  type NodeData,
} from '../shared/node-model';

// Re-exported so existing builder-scoped imports keep working. These now live
// in the shared node model that both the builder and config editor consume.
export {
  NODE_TYPES,
  NODE_TYPE_LABELS,
  NODE_TYPE_DESCRIPTIONS,
  SCM_ACTIONS,
  SCM_ACTION_LABELS,
  defaultInstructionsPath,
  type ScmAction,
  type NodeData,
  type WorkflowNodeConfigLike,
} from '../shared/node-model';

export interface BuilderConfig {
  project?: { name: string; defaultBranch: string; branchFormat?: string };
  workflow: WorkflowConfig;
  board?: { swimlanes: string[] };
  subWorkflows?: Record<string, WorkflowConfig>;
}

/**
 * Editable data carried by each canvas node. Extends the shared {@link NodeData}
 * with `nodeId` — the user-facing workflow node id (which can be renamed freely);
 * the React Flow node `id` is a separate stable internal key so edges survive
 * renames.
 */
export interface BuilderNodeData extends NodeData, Record<string, unknown> {
  nodeId: string;
}

export type BuilderNode = Node<BuilderNodeData>;

let idCounter = 0;
/** Stable-ish unique internal key for a canvas node. */
export function nextNodeKey(): string {
  idCounter += 1;
  return `n_${idCounter}_${Math.random().toString(36).slice(2, 7)}`;
}

const LAYER_X = 260;
const ROW_Y = 130;
const ORIGIN_X = 60;
const ORIGIN_Y = 60;

/**
 * Assign each node a layer via longest-path layering over the dependency DAG so
 * an unlaid-out workflow renders left-to-right by execution order. Nodes with a
 * cycle (shouldn't happen for valid configs) or missing deps fall back to layer
 * 0. Returns positions keyed by workflow node id.
 */
function layoutByRank(
  ids: string[],
  dependsOn: Map<string, string[]>,
): Map<string, { x: number; y: number }> {
  const rank = new Map<string, number>();
  const idSet = new Set(ids);

  const computeRank = (id: string, seen: Set<string>): number => {
    if (rank.has(id)) return rank.get(id) as number;
    if (seen.has(id)) return 0;
    seen.add(id);
    const deps = (dependsOn.get(id) ?? []).filter((d) => idSet.has(d));
    const value = deps.length === 0 ? 0 : Math.max(...deps.map((d) => computeRank(d, seen) + 1));
    rank.set(id, value);
    seen.delete(id);
    return value;
  };

  for (const id of ids) computeRank(id, new Set());

  const rowByLayer = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const layer = rank.get(id) ?? 0;
    const row = rowByLayer.get(layer) ?? 0;
    rowByLayer.set(layer, row + 1);
    positions.set(id, { x: ORIGIN_X + layer * LAYER_X, y: ORIGIN_Y + row * ROW_Y });
  }
  return positions;
}

/**
 * A horizontal swimlane in the builder canvas. Each lane maps to a board swimlane
 * (plus a trailing "unassigned" lane) so nodes visually sit in the stage where
 * they move the ticket.
 */
export interface Lane {
  key: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}

/** Lane key used for nodes that have no board swimlane assigned. */
export const UNASSIGNED_LANE = '__unassigned__';

const SW_LAYER_X = 260;
const SW_ROW_Y = 104;
const LANE_HEADER_H = 38;
const LANE_PAD_Y = 18;
const LANE_PAD_X = 28;
const MIN_LANE_WIDTH = 960;
/** Approximate rendered height of a node card; used for lane hit-testing. */
export const NODE_CARD_HEIGHT = 76;

/** Longest-path rank per React Flow node id, derived from the edge list. */
function ranksFromEdges(nodeIds: string[], edges: Edge[]): Map<string, number> {
  const preds = new Map<string, string[]>();
  for (const id of nodeIds) preds.set(id, []);
  for (const e of edges) {
    if (preds.has(e.target) && preds.has(e.source)) preds.get(e.target)?.push(e.source);
  }
  const rank = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    const cached = rank.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0;
    seen.add(id);
    const list = preds.get(id) ?? [];
    const value = list.length === 0 ? 0 : Math.max(...list.map((p) => visit(p, seen) + 1));
    seen.delete(id);
    rank.set(id, value);
    return value;
  };
  for (const id of nodeIds) visit(id, new Set());
  return rank;
}

/** Y of the first node row inside a lane. */
export function laneContentTop(lane: Lane): number {
  return lane.y + LANE_HEADER_H + LANE_PAD_Y;
}

/** Keep a node's top-left Y inside a lane's usable band. */
export function clampYToLane(lane: Lane, y: number): number {
  const top = laneContentTop(lane) - 6;
  const bottom = lane.y + lane.height - NODE_CARD_HEIGHT - LANE_PAD_Y + 6;
  return Math.min(Math.max(y, top), Math.max(top, bottom));
}

/** Which lane contains the given flow-space Y (clamped to the ends). */
export function laneForY(lanes: Lane[], y: number): Lane | null {
  if (lanes.length === 0) return null;
  for (const lane of lanes) {
    if (y >= lane.y && y < lane.y + lane.height) return lane;
  }
  return y < lanes[0].y ? lanes[0] : lanes[lanes.length - 1];
}

/**
 * Arrange nodes into horizontal swimlanes: one lane per board swimlane (in order),
 * any extra swimlanes found on nodes, then a trailing "unassigned" lane. Within a
 * lane, nodes flow left-to-right by execution rank and stack into rows when they
 * share a rank. Returns repositioned nodes plus the lane bands to render.
 */
export function layoutSwimlanes(
  nodes: BuilderNode[],
  edges: Edge[],
  swimlanes: string[],
): { nodes: BuilderNode[]; lanes: Lane[] } {
  const laneKeys: string[] = [...swimlanes];
  const seen = new Set(laneKeys);
  for (const n of nodes) {
    const c = n.data.swimlane;
    if (c && !seen.has(c)) {
      seen.add(c);
      laneKeys.push(c);
    }
  }
  laneKeys.push(UNASSIGNED_LANE);

  const laneKeySet = new Set(laneKeys);
  const rank = ranksFromEdges(nodes.map((n) => n.id), edges);
  const maxRank = nodes.length === 0 ? 0 : Math.max(0, ...nodes.map((n) => rank.get(n.id) ?? 0));
  const width = Math.max(MIN_LANE_WIDTH, LANE_PAD_X * 2 + (maxRank + 1) * SW_LAYER_X);

  const byLane = new Map<string, BuilderNode[]>();
  for (const key of laneKeys) byLane.set(key, []);
  for (const n of nodes) {
    const key = n.data.swimlane && laneKeySet.has(n.data.swimlane) ? n.data.swimlane : UNASSIGNED_LANE;
    byLane.get(key)?.push(n);
  }

  const lanes: Lane[] = [];
  const positioned: BuilderNode[] = [];
  let top = 0;
  laneKeys.forEach((key, index) => {
    const laneNodes = byLane.get(key) ?? [];
    const rowByRank = new Map<number, number>();
    let maxRows = 1;
    for (const n of laneNodes) {
      const r = rank.get(n.id) ?? 0;
      const row = rowByRank.get(r) ?? 0;
      rowByRank.set(r, row + 1);
      maxRows = Math.max(maxRows, row + 1);
      positioned.push({
        ...n,
        position: {
          x: LANE_PAD_X + r * SW_LAYER_X,
          y: top + LANE_HEADER_H + LANE_PAD_Y + row * SW_ROW_Y,
        },
      });
    }
    const height = LANE_HEADER_H + LANE_PAD_Y * 2 + maxRows * SW_ROW_Y;
    lanes.push({
      key,
      label: key === UNASSIGNED_LANE ? 'Unassigned' : key,
      x: 0,
      y: top,
      width,
      height,
      index,
    });
    top += height;
  });

  return { nodes: positioned, lanes };
}

/** Convert a workflow config into React Flow nodes + edges with auto-layout. */
export function workflowToGraph(workflow: WorkflowConfig | null | undefined): {
  nodes: BuilderNode[];
  edges: Edge[];
} {
  const configNodes = workflow?.nodes ?? [];
  const ids = configNodes.map((n) => n.id);
  const dependsOn = new Map<string, string[]>();
  for (const n of configNodes) dependsOn.set(n.id, n.dependsOn ?? []);

  const positions = layoutByRank(ids, dependsOn);
  const keyByNodeId = new Map<string, string>();

  const nodes: BuilderNode[] = configNodes.map((n) => {
    const key = nextNodeKey();
    keyByNodeId.set(n.id, key);
    return {
      id: key,
      type: 'workflow',
      position: positions.get(n.id) ?? { x: ORIGIN_X, y: ORIGIN_Y },
      data: {
        nodeId: n.id,
        ...nodeConfigToData(n),
      },
    };
  });

  const edges: Edge[] = [];
  for (const n of configNodes) {
    const target = keyByNodeId.get(n.id);
    if (!target) continue;
    for (const dep of n.dependsOn ?? []) {
      const source = keyByNodeId.get(dep);
      if (!source) continue;
      edges.push({ id: `${source}->${target}`, source, target });
    }
  }

  return { nodes, edges };
}

/**
 * Would adding an edge `source -> target` create a cycle? True when `target`
 * can already reach `source` by following existing edges (source→target).
 */
export function wouldCreateCycle(edges: Edge[], source: string, target: string): boolean {
  if (source === target) return true;
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.source) ?? [];
    list.push(e.target);
    adjacency.set(e.source, list);
  }
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop() as string;
    if (current === source) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
  }
  return false;
}

/** Serialize the current canvas graph back into a `WorkflowConfig`. */
export function graphToWorkflow(
  name: string,
  nodes: BuilderNode[],
  edges: Edge[],
  budget?: BudgetConfig,
): WorkflowConfig {
  const nodeIdByKey = new Map<string, string>();
  for (const n of nodes) nodeIdByKey.set(n.id, n.data.nodeId.trim());

  const depsByKey = new Map<string, string[]>();
  for (const e of edges) {
    const depId = nodeIdByKey.get(e.source);
    if (!depId) continue;
    const list = depsByKey.get(e.target) ?? [];
    if (!list.includes(depId)) list.push(depId);
    depsByKey.set(e.target, list);
  }

  const workflow: WorkflowConfig = {
    name: name.trim() || 'default',
    nodes: nodes.map((n) => dataToNodeConfig(n.data, n.data.nodeId, depsByKey.get(n.id) ?? [])),
  };
  const cleanBudget: BudgetConfig = {};
  if (typeof budget?.maxTokens === 'number') cleanBudget.maxTokens = budget.maxTokens;
  if (typeof budget?.maxCostUsd === 'number') cleanBudget.maxCostUsd = budget.maxCostUsd;
  if (Object.keys(cleanBudget).length > 0) workflow.budget = cleanBudget;
  return workflow;
}

/**
 * Build a complete `.orion/config.yaml` string from all config sections. Parses
 * the current raw YAML as a baseline so that sections the builder doesn't touch
 * (e.g. `mcpServers`) survive the round-trip. Sections explicitly provided
 * replace their counterparts in the baseline.
 */
export function buildFullYaml(
  currentYaml: string | null,
  config: BuilderConfig,
): string {
  let root: Record<string, unknown> = {};
  try {
    const parsed = currentYaml ? parse(currentYaml) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      root = parsed as Record<string, unknown>;
    }
  } catch {
    root = {};
  }
  if (config.project) {
    root.project = {
      name: config.project.name,
      defaultBranch: config.project.defaultBranch || 'main',
      ...(config.project.branchFormat ? { branchFormat: config.project.branchFormat } : {}),
    };
  }
  root.workflow = config.workflow;
  if (config.board) {
    root.board = {
      swimlanes: config.board.swimlanes,
    };
  }
  // Only replace `workflows` when sub-workflows are explicitly provided; when
  // they are not modeled by the caller, leave whatever is in the baseline so
  // existing reusable sub-workflows are preserved across a save.
  if (config.subWorkflows && Object.keys(config.subWorkflows).length > 0) {
    root.workflows = config.subWorkflows;
  }
  return stringify(root, { indent: 2, lineWidth: 0 });
}

/** A short one-line summary of a node for its canvas card. */
export function nodeSummary(data: BuilderNodeData): string {
  if (data.matrix) return 'matrix fan-out';
  if (data.loop) return `loop ×${data.loop.maxIterations}`;
  switch (data.type) {
    case 'agent': {
      const parts: string[] = [];
      if (data.provider) parts.push(data.provider);
      if (data.skills?.length) parts.push(`${data.skills.length} skill${data.skills.length > 1 ? 's' : ''}`);
      if (data.mcpServers && Object.keys(data.mcpServers).length) {
        parts.push(`${Object.keys(data.mcpServers).length} MCP`);
      }
      return parts.length > 0 ? parts.join(' · ') : 'no provider';
    }
    case 'shell':
      return data.script ? data.script.split('\n')[0] : 'no script';
    case 'scm':
      return data.action || 'no action';
    case 'approval':
      return 'manual approval';
    case 'message': {
      const target = data.messageTarget ?? 'notify';
      if (data.agentGenerated) return `${target}: agent-written`;
      return data.message ? `${target}: ${data.message.split('\n')[0]}` : `${target}: no message`;
    }
    case 'condition': {
      if (data.branches?.length) {
        const labels = data.branches.map(
          (b, i) => b.expression ?? (i === data.branches!.length - 1 ? 'else' : '?'),
        );
        return `if/else: ${labels.join(' → ')}`;
      }
      return data.condition ? `if ${data.condition}` : 'no condition';
    }
    case 'http':
      return data.url ? `${(data.method || 'GET').toUpperCase()} ${data.url}` : 'no url';
    case 'graphql':
      return data.url ? `graphql ${data.url}` : 'no url';
    default:
      return data.type;
  }
}

/** Client-side validation mirroring the server's semantic checks. */
export function validateGraph(nodes: BuilderNode[]): string[] {
  const issues: string[] = [];
  if (nodes.length === 0) issues.push('Add at least one workflow node.');
  const ids = nodes.map((n) => n.data.nodeId.trim());
  const idSet = new Set(ids.filter(Boolean));
  if (ids.some((id) => !id)) issues.push('Every node needs an id.');
  if (idSet.size !== ids.filter(Boolean).length) issues.push('Node ids must be unique.');
  for (const n of nodes) {
    issues.push(...validateNodeData(n.data, n.data.nodeId));
  }
  return issues;
}
