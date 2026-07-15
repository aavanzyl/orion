import { parse, stringify } from 'yaml';
import type {
  BudgetConfig,
  IssueTypeConfig,
  McpServerMap,
  ProjectConfig,
  WorkflowConfig,
  WorkflowNodeConfig,
} from '@orion/models';
import {
  coerceNodeType,
  dataToNodeConfig,
  nodeConfigToData,
  validateNodeData,
  type NodeData,
} from '../shared/node-model';


/**
 * A single workflow node as edited by the config form. This is the shared
 * {@link NodeData} plus the form/graph plumbing the config surface owns: a stable
 * React list `key`, the user-facing `id`, and its `dependsOn` list.
 */
export type NodeFormModel = NodeData & {
  key: string;
  id: string;
  dependsOn: string[];
};

export interface ConfigFormModel {
  projectName: string;
  defaultBranch: string;
  /** Branch-name template. Preserved and editable so round-tripping is not lossy. */
  branchFormat?: string;
  /** Preserved project-wide MCP servers so round-tripping is not lossy. */
  mcpServers?: McpServerMap;
  swimlanes: string[];
  triggerSwimlane?: string;
  workflowName: string;
  /** Workflow token/cost budget. */
  budget?: BudgetConfig;
  /** Preserved reusable sub-workflows so round-tripping is not lossy. */
  workflows?: Record<string, WorkflowConfig>;
  /** Configured issue types mapping to workflows. */
  issueTypes?: IssueTypeConfig[];
  nodes: NodeFormModel[];
  /**
   * The full parsed YAML root the model was derived from. On save the modeled
   * sections are overlaid onto this baseline so unknown/untouched top-level keys
   * survive the round-trip (mirrors the builder's `buildFullYaml`).
   */
  baseline?: Record<string, unknown>;
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
    laneIndex.get((n.swimlane ?? '').trim()) ?? swimlanes.length;

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
      instructions: 'instructions/implement.md',
      swimlane: 'in_progress',
      dependsOn: [],
      skills: [],
    },
    {
      key: nextKey('node'),
      id: 'approval',
      type: 'approval',
      swimlane: 'review',
      dependsOn: ['implement'],
    },
    {
      key: nextKey('node'),
      id: 'open_pr',
      type: 'scm',
      action: 'open_pull_request',
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

/** Coerce an unknown value into a sub-workflow map, or undefined when absent. */
function subWorkflowMap(value: unknown): Record<string, WorkflowConfig> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, WorkflowConfig>)
    : undefined;
}

/** Read numeric budget fields, or undefined when neither is present. */
function budgetConfig(value: unknown): BudgetConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const budget: BudgetConfig = {};
  if (typeof raw.maxTokens === 'number') budget.maxTokens = raw.maxTokens;
  if (typeof raw.maxCostUsd === 'number') budget.maxCostUsd = raw.maxCostUsd;
  return Object.keys(budget).length > 0 ? budget : undefined;
}

/** Built-in issue type defaults pre-populated in the editor when none are configured. */
function DEFAULT_MODEL_ISSUE_TYPES(workflowName: string): IssueTypeConfig[] {
  return [
    { name: 'feature', label: 'Feature', workflow: workflowName },
    { name: 'bug', label: 'Bug', workflow: workflowName },
    { name: 'issue', label: 'Issue', workflow: workflowName },
    { name: 'hotfix', label: 'Hotfix', workflow: workflowName },
  ];
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

  const swimlanes = Array.isArray(board.swimlanes)
    ? board.swimlanes
    : Array.isArray(board.columns)
      ? board.columns
      : [];
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];

  return {
    baseline: raw,
    projectName: str(project.name),
    defaultBranch: str(project.defaultBranch) || 'main',
    branchFormat: str(project.branchFormat) || undefined,
    mcpServers: mcpMap(raw.mcpServers),
    workflows: subWorkflowMap(raw.workflows),
    issueTypes: Array.isArray(raw.issueTypes)
      ? (raw.issueTypes as IssueTypeConfig[])
      : DEFAULT_MODEL_ISSUE_TYPES(str(workflow.name) || 'default'),
    swimlanes: swimlanes.map((c) => str(c)).filter(Boolean),
    triggerSwimlane: typeof board.triggerSwimlane === 'string' ? board.triggerSwimlane : undefined,
    workflowName: str(workflow.name) || 'default',
    budget: budgetConfig(workflow.budget),
    nodes: nodes.map((n) => {
      const node = (n ?? {}) as Record<string, unknown>;
      const normalized = {
        ...node,
        type: coerceNodeType(node.type),
      } as WorkflowNodeConfig;
      const dependsOn = Array.isArray(node.dependsOn)
        ? node.dependsOn.map((d) => str(d)).filter(Boolean)
        : [];
      return {
        key: nextKey('node'),
        id: str(node.id),
        dependsOn,
        ...nodeConfigToData(normalized),
      };
    }),
  };
}

/** Filter a budget down to its known, numeric fields. */
function cleanBudget(budget: BudgetConfig): BudgetConfig {
  const clean: BudgetConfig = {};
  if (typeof budget.maxTokens === 'number') clean.maxTokens = budget.maxTokens;
  if (typeof budget.maxCostUsd === 'number') clean.maxCostUsd = budget.maxCostUsd;
  return clean;
}

/** Build a clean ProjectConfig object from the form model, dropping empties. */
function modelToConfig(model: ConfigFormModel): ProjectConfig {
  const budget = model.budget ? cleanBudget(model.budget) : {};
  const config: ProjectConfig = {
    project: {
      name: model.projectName.trim(),
      defaultBranch: model.defaultBranch.trim() || 'main',
      ...(model.branchFormat?.trim() ? { branchFormat: model.branchFormat.trim() } : {}),
    },
    board: {
      swimlanes: model.swimlanes.map((c) => c.trim()).filter(Boolean),
      ...(model.triggerSwimlane ? { triggerSwimlane: model.triggerSwimlane } : {}),
    },
    workflow: {
      name: model.workflowName.trim() || 'default',
      nodes: model.nodes.map((n) => dataToNodeConfig(n, n.id, n.dependsOn)),
      ...(Object.keys(budget).length ? { budget } : {}),
    },
  };
  if (model.mcpServers && Object.keys(model.mcpServers).length) {
    config.mcpServers = model.mcpServers;
  }
  if (model.workflows && Object.keys(model.workflows).length) {
    config.workflows = model.workflows;
  }
  if (model.issueTypes && model.issueTypes.length) {
    config.issueTypes = model.issueTypes;
  }
  return config;
}

/**
 * Serialize the form model to YAML text, overlaying the modeled sections onto
 * the preserved baseline so unknown/untouched top-level keys survive.
 */
export function modelToYaml(model: ConfigFormModel): string {
  const root: Record<string, unknown> = model.baseline
    ? (JSON.parse(JSON.stringify(model.baseline)) as Record<string, unknown>)
    : {};
  const config = modelToConfig(model);
  root.project = config.project;
  root.board = config.board;
  root.workflow = config.workflow;
  if (config.mcpServers) root.mcpServers = config.mcpServers;
  else delete root.mcpServers;
  if (config.workflows) root.workflows = config.workflows;
  else delete root.workflows;
  if (config.issueTypes) root.issueTypes = config.issueTypes;
  else delete root.issueTypes;
  return stringify(root, { indent: 2, lineWidth: 0 });
}

/** The parts of a bundled workflow template needed to apply it client-side. */
interface WorkflowTemplateApply {
  /** The template's `workflow:` block as YAML text. */
  yaml: string;
  suggestedSwimlanes: string[];
}

/**
 * Merge a workflow template into raw config YAML: replace the `workflow:` block
 * and union in the template's suggested board swimlanes so the result stays
 * referentially valid. Preserves other existing config. Falls back to a minimal
 * scaffold when the current YAML is empty or unparseable.
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
  const existingSwimlanes = Array.isArray(board.swimlanes)
    ? board.swimlanes.map(String)
    : Array.isArray(board.columns)
      ? board.columns.map(String)
      : [];
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
    issues.push(...validateNodeData(node, id));
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
