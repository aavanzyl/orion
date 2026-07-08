import { parse, stringify } from 'yaml';
import type {
  LoopConfig,
  McpServerMap,
  ProjectConfig,
  WorkflowNodeType,
} from '@orion/models';

export const WORKFLOW_NODE_TYPES: WorkflowNodeType[] = [
  'agent',
  'shell',
  'approval',
  'scm',
  'notify',
  'comment',
  'condition',
  'http',
];

export interface NodeFormModel {
  key: string;
  id: string;
  type: WorkflowNodeType;
  provider: string;
  model: string;
  baseUrl: string;
  instructions: string;
  action: string;
  script: string;
  swimlane: string;
  dependsOn: string[];
  /** Preserved loop config so round-tripping is not lossy. */
  loop?: LoopConfig;
  /** Preserved free-form provider config so round-tripping is not lossy. */
  config?: Record<string, unknown>;
  /** Preserved per-node MCP servers so round-tripping is not lossy. */
  mcpServers?: McpServerMap;
  /** Skills enabled for this node. */
  skills?: string[];
}

export interface ConfigFormModel {
  projectName: string;
  defaultBranch: string;
  /** Preserved project-wide MCP servers so round-tripping is not lossy. */
  mcpServers?: McpServerMap;
  swimlanes: string[];
  workflowName: string;
  nodes: NodeFormModel[];
}

let keyCounter = 0;
/** Stable-ish unique key for React list rendering. */
export function nextKey(prefix: string): string {
  keyCounter += 1;
  return `${prefix}-${keyCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Order nodes by swimlane (following the board's swimlane order) and then by
 * their depends-on relationship (longest-path topological rank). Nodes without
 * a known swimlane sort last; ties fall back to the original order so the sort
 * is stable. Returns a new array and never mutates the input.
 */
export function sortNodes(nodes: NodeFormModel[], swimlanes: string[]): NodeFormModel[] {
  const laneIndex = new Map<string, number>();
  swimlanes.forEach((s, i) => {
    const key = s.trim();
    if (key && !laneIndex.has(key)) laneIndex.set(key, i);
  });
  const laneRank = (n: NodeFormModel): number =>
    laneIndex.get(n.swimlane.trim()) ?? swimlanes.length;

  const byId = new Map<string, NodeFormModel>();
  for (const n of nodes) {
    const id = n.id.trim();
    if (id) byId.set(id, n);
  }
  const depRank = new Map<string, number>();
  const rankOf = (node: NodeFormModel, seen: Set<string>): number => {
    const id = node.id.trim();
    if (id && depRank.has(id)) return depRank.get(id) as number;
    if (id && seen.has(id)) return 0;
    if (id) seen.add(id);
    const deps = node.dependsOn
      .map((d) => byId.get(d))
      .filter((d): d is NodeFormModel => Boolean(d));
    const value = deps.length === 0 ? 0 : Math.max(...deps.map((d) => rankOf(d, seen) + 1));
    if (id) {
      depRank.set(id, value);
      seen.delete(id);
    }
    return value;
  };

  const originalIndex = new Map<NodeFormModel, number>();
  nodes.forEach((n, i) => originalIndex.set(n, i));

  return [...nodes].sort((a, b) => {
    const laneDiff = laneRank(a) - laneRank(b);
    if (laneDiff !== 0) return laneDiff;
    const rankDiff = rankOf(a, new Set()) - rankOf(b, new Set());
    if (rankDiff !== 0) return rankDiff;
    return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
  });
}

export const CONFIG_TEMPLATE_MODEL = (): ConfigFormModel => ({
  projectName: 'my-project',
  defaultBranch: 'main',
  swimlanes: ['backlog', 'in_progress', 'review', 'done'],
  workflowName: 'default',
  nodes: [
    {
      key: nextKey('node'),
      id: 'implement',
      type: 'agent',
      provider: 'codex',
      model: 'gpt-5-codex',
      baseUrl: '',
      instructions: 'commands/implement.md',
      action: '',
      script: '',
      swimlane: 'in_progress',
      dependsOn: [],
      skills: [],
    },
    {
      key: nextKey('node'),
      id: 'approval',
      type: 'approval',
      provider: '',
      model: '',
      baseUrl: '',
      instructions: '',
      action: '',
      script: '',
      swimlane: 'review',
      dependsOn: ['implement'],
    },
    {
      key: nextKey('node'),
      id: 'open_pr',
      type: 'scm',
      provider: '',
      model: '',
      baseUrl: '',
      instructions: '',
      action: 'open_pull_request',
      script: '',
      swimlane: 'done',
      dependsOn: ['approval'],
    },
  ],
});

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Coerce an unknown value into an MCP server map, or undefined when absent. */
function mcpMap(value: unknown): McpServerMap | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as McpServerMap)
    : undefined;
}

/** Coerce an unknown value into a loop config, or undefined when absent/invalid. */
function loopConfig(value: unknown): LoopConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const loop = value as Record<string, unknown>;
  if (typeof loop.maxIterations !== 'number' || typeof loop.until !== 'string') {
    return undefined;
  }
  return {
    maxIterations: loop.maxIterations,
    until: loop.until,
    ...(typeof loop.freshContext === 'boolean' ? { freshContext: loop.freshContext } : {}),
  };
}

/**
 * Parse raw YAML text into the editable form model. Throws when the YAML is
 * syntactically invalid so the caller can keep the user in the raw editor.
 */
export function parseConfigToModel(yaml: string): ConfigFormModel {
  const raw = (parse(yaml) ?? {}) as Record<string, unknown>;
  const project = (raw.project ?? {}) as Record<string, unknown>;
  const board = (raw.board ?? {}) as Record<string, unknown>;
  const workflow = (raw.workflow ?? {}) as Record<string, unknown>;

  const swimlanes = Array.isArray(board.swimlanes) ? board.swimlanes : Array.isArray(board.columns) ? board.columns : [];
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];

  return {
    projectName: str(project.name),
    defaultBranch: str(project.defaultBranch) || 'main',
    mcpServers: mcpMap(raw.mcpServers),
    swimlanes: swimlanes.map((c) => str(c)).filter(Boolean),
    workflowName: str(workflow.name) || 'default',
    nodes: nodes.map((n) => {
      const node = (n ?? {}) as Record<string, unknown>;
      const type = WORKFLOW_NODE_TYPES.includes(node.type as WorkflowNodeType)
        ? (node.type as WorkflowNodeType)
        : 'agent';
      const dependsOn = Array.isArray(node.dependsOn)
        ? node.dependsOn.map((d) => str(d)).filter(Boolean)
        : [];
      return {
        key: nextKey('node'),
        id: str(node.id),
        type,
        provider: str(node.provider),
        model: str(node.model),
        baseUrl: str(node.baseUrl),
        instructions: str(node.instructions) || str(node.command) || str(node.prompt),
        action: str(node.action),
        script: str(node.script),
        swimlane: str(node.swimlane),
        dependsOn,
        loop: loopConfig(node.loop),
        config:
          node.config && typeof node.config === 'object'
            ? (node.config as Record<string, unknown>)
            : undefined,
        mcpServers: mcpMap(node.mcpServers),
        skills: Array.isArray(node.skills) ? node.skills.map(String).filter(Boolean) : undefined,
      };
    }),
  };
}

/** Build a clean ProjectConfig object from the form model, dropping empties. */
export function modelToConfig(model: ConfigFormModel): ProjectConfig {
  return {
    project: {
      name: model.projectName.trim(),
      defaultBranch: model.defaultBranch.trim() || 'main',
    },
    ...(model.mcpServers && Object.keys(model.mcpServers).length
      ? { mcpServers: model.mcpServers }
      : {}),
    board: { swimlanes: model.swimlanes.map((c) => c.trim()).filter(Boolean) },
    workflow: {
      name: model.workflowName.trim() || 'default',
      nodes: model.nodes.map((n) => {
        const isAgent = n.type === 'agent';
        const isShell = n.type === 'shell';
        const isScm = n.type === 'scm';
        return {
          id: n.id.trim(),
          type: n.type,
          ...(isAgent && n.provider.trim() ? { provider: n.provider.trim() } : {}),
          ...(isAgent && n.model.trim() ? { model: n.model.trim() } : {}),
          ...(isAgent && n.baseUrl.trim() ? { baseUrl: n.baseUrl.trim() } : {}),
          ...(isAgent && n.instructions.trim() ? { instructions: n.instructions.trim() } : {}),
          ...(isAgent && n.mcpServers && Object.keys(n.mcpServers).length
            ? { mcpServers: n.mcpServers }
            : {}),
          ...(isAgent && n.skills && n.skills.length
            ? { skills: n.skills }
            : {}),
          ...(isAgent && n.config ? { config: n.config } : {}),
          ...(isScm && n.action.trim() ? { action: n.action.trim() } : {}),
          ...(isShell && n.script.trim() ? { script: n.script.trim() } : {}),
          ...(n.dependsOn.length ? { dependsOn: n.dependsOn } : {}),
          ...(n.swimlane ? { swimlane: n.swimlane } : {}),
          ...(n.loop && (isAgent || isShell) ? { loop: n.loop } : {}),
        };
      }),
    },
  };
}

/** Serialize the form model to YAML text. */
export function modelToYaml(model: ConfigFormModel): string {
  return stringify(modelToConfig(model), { indent: 2, lineWidth: 0 });
}

/** The parts of a bundled workflow template needed to apply it client-side. */
export interface WorkflowTemplateApply {
  /** The template's `workflow:` block as YAML text. */
  yaml: string;
  suggestedSwimlanes: string[];
}

/**
 * Merge a workflow template into raw config YAML: replace the `workflow:` block
 * and union in the template's suggested agents (by id) and board swimlanes so the
 * result stays referentially valid. Preserves other existing config. Falls back
 * to a minimal scaffold when the current YAML is empty or unparseable.
 */
export function applyWorkflowTemplate(
  currentYaml: string,
  template: WorkflowTemplateApply,
): string {
  let root: Record<string, unknown> = {};
  try {
    const parsed = parse(currentYaml);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      root = parsed as Record<string, unknown>;
    }
  } catch {
    root = {};
  }

  const parsedTemplate = (parse(template.yaml) ?? {}) as Record<string, unknown>;
  root.workflow = parsedTemplate.workflow ?? parsedTemplate;

  if (!root.project || typeof root.project !== 'object') {
    root.project = { name: 'my-project', defaultBranch: 'main' };
  }

  const board = (root.board && typeof root.board === 'object' ? root.board : {}) as Record<
    string,
    unknown
  >;
  const existingSwimlanes = Array.isArray(board.swimlanes) ? board.swimlanes.map(String)
    : Array.isArray(board.columns) ? board.columns.map(String) : [];
  const swimlanes = [...existingSwimlanes];
  for (const sw of template.suggestedSwimlanes) {
    if (!swimlanes.includes(sw)) swimlanes.push(sw);
  }
  root.board = { ...board, swimlanes };

  return stringify(root, { indent: 2, lineWidth: 0 });
}

/**
 * Lightweight client-side validation mirroring the server's semantic checks,
 * used to surface issues inline before saving.
 */
export function validateModel(model: ConfigFormModel): string[] {
  const issues: string[] = [];

  if (!model.projectName.trim()) issues.push('Project name is required.');
  if (model.swimlanes.filter((c) => c.trim()).length === 0) {
    issues.push('Add at least one board swimlane.');
  }
  if (model.nodes.length === 0) issues.push('Add at least one workflow node.');

  const swimlaneKeys = new Set(model.swimlanes.map((c) => c.trim()).filter(Boolean));
  const nodeIds = model.nodes.map((n) => n.id.trim()).filter(Boolean);
  const nodeIdSet = new Set(nodeIds);

  if (nodeIdSet.size !== nodeIds.length) {
    issues.push('Workflow node ids must be unique.');
  }

  for (const node of model.nodes) {
    const id = node.id.trim() || '(unnamed)';
    if (!node.id.trim()) issues.push('Every workflow node needs an id.');
    if (node.type === 'agent' && !node.provider.trim()) {
      issues.push(`Node "${id}" is an agent node but has no provider selected.`);
    }
    if (node.type === 'scm' && !node.action.trim()) {
      issues.push(`Node "${id}" is an scm node but has no action.`);
    }
    if (node.type === 'shell' && !node.script.trim()) {
      issues.push(`Node "${id}" is a shell node but has no script.`);
    }
    if (node.swimlane && !swimlaneKeys.has(node.swimlane)) {
      issues.push(`Node "${id}" references unknown swimlane "${node.swimlane}".`);
    }
    for (const dep of node.dependsOn) {
      if (!nodeIdSet.has(dep)) {
        issues.push(`Node "${id}" depends on unknown node "${dep}".`);
      }
    }
  }

  return issues;
}
