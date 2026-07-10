import type { ProjectConfig } from '@orion/models';
import { ConfigError } from './errors.js';
import { tryEvaluateCondition } from './conditions.js';
import { flattenProjectConfig } from './flatten.js';

/**
 * Semantic validation beyond the zod schema: referential integrity between
 * nodes, agents and board columns, plus a check that the workflow graph is a
 * DAG (no cycles, no dangling dependencies).
 */
export function assertValidConfig(config: ProjectConfig): void {
  const issues: string[] = [];

  const swimlaneKeys = new Set(
    (config.board as unknown as { swimlanes: string[]; columns?: string[] }).swimlanes ??
      (config.board as unknown as { swimlanes: string[]; columns?: string[] }).columns ??
      [],
  );
  const nodeIds = new Set(config.workflow.nodes.map((n) => n.id));

  if (nodeIds.size !== config.workflow.nodes.length) {
    issues.push('workflow node ids must be unique');
  }

  for (const node of config.workflow.nodes) {
    validateNode(node, swimlaneKeys, nodeIds, issues);
    if (node.type === 'workflow') {
      if (!node.workflow) {
        issues.push(`workflow node "${node.id}" has no workflow reference`);
      } else if (!config.workflows || !config.workflows[node.workflow]) {
        issues.push(
          `workflow node "${node.id}" references unknown sub-workflow "${node.workflow}"`,
        );
      }
    }
  }

  if (config.workflows) {
    for (const [key, subWorkflow] of Object.entries(config.workflows)) {
      const subNodeIds = new Set(subWorkflow.nodes.map((n) => n.id));
      if (subNodeIds.size !== subWorkflow.nodes.length) {
        issues.push(`sub-workflow "${key}" has duplicate node ids`);
      }
      for (const node of subWorkflow.nodes) {
        validateNode(node, swimlaneKeys, subNodeIds, issues);
      }
    }

    if (hasSubWorkflowCycle(config.workflows)) {
      issues.push('sub-workflow references contain a cycle');
    }
  }

  if (issues.length === 0) {
    try {
      const flattened = flattenProjectConfig(config);
      const flatNodeIds = new Set(flattened.workflow.nodes.map((n) => n.id));
      if (flatNodeIds.size !== flattened.workflow.nodes.length) {
        issues.push(
          'flattened workflow has duplicate node ids; sub-workflow node ids must be globally unique',
        );
      }
      for (const node of flattened.workflow.nodes) {
        for (const dep of node.dependsOn ?? []) {
          if (!flatNodeIds.has(dep)) {
            issues.push(
              `node "${node.id}" depends on unknown node "${dep}" in the flattened graph`,
            );
          }
        }
      }
      if (issues.length === 0 && hasCycle(flattened)) {
        issues.push('flattened workflow graph contains a cycle; it must be a DAG');
      }
    } catch (err) {
      issues.push(
        `flattening failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (issues.length > 0) {
    throw new ConfigError('Invalid Orion configuration', issues);
  }
}

function validateNode(
  node: { id: string; type: string; provider?: string; action?: string; agentGenerated?: boolean; script?: string; message?: string; condition?: string; url?: string; query?: string; swimlane?: string; dependsOn?: string[]; retries?: number; retryDelayMs?: number; timeoutMs?: number; loop?: unknown; matrix?: unknown },
  swimlaneKeys: Set<string>,
  nodeIds: Set<string>,
  issues: string[],
): void {
  if (node.type === 'agent') {
    if (!node.provider) {
      issues.push(`node "${node.id}" is type agent but has no provider set`);
    }
  }
  if (node.type === 'scm' && !node.action) {
    issues.push(`node "${node.id}" is type scm but has no action set`);
  }
  if (node.type === 'shell' && !node.script) {
    issues.push(`node "${node.id}" is type shell but has no script set`);
  }
  if (node.type === 'message') {
    if (!node.agentGenerated && !node.message) {
      issues.push(`node "${node.id}" is type message but has no message set`);
    }
  }
  if (node.type === 'condition') {
    if (!node.condition) {
      issues.push(`node "${node.id}" is type condition but has no condition expression set`);
    } else if (!tryEvaluateCondition(node.condition, {}).ok) {
      issues.push(`node "${node.id}" has a malformed condition expression: ${node.condition}`);
    }
  }
  if (node.type === 'http' && !node.url) {
    issues.push(`node "${node.id}" is type http but has no url set`);
  }
  if (node.type === 'graphql') {
    if (!node.url) {
      issues.push(`node "${node.id}" is type graphql but has no url set`);
    }
    if (!node.query) {
      issues.push(`node "${node.id}" is type graphql but has no query set`);
    }
  }
  if (node.swimlane && !swimlaneKeys.has(node.swimlane)) {
    issues.push(`node "${node.id}" references unknown swimlane "${node.swimlane}"`);
  }
  for (const dep of node.dependsOn ?? []) {
    if (!nodeIds.has(dep)) {
      issues.push(`node "${node.id}" depends on unknown node "${dep}"`);
    }
  }
  const supportsRetryPolicy =
    node.type === 'agent' || node.type === 'http' || node.type === 'graphql';
  if (!supportsRetryPolicy) {
    if (node.retries !== undefined) {
      issues.push(`node "${node.id}" sets retries but only agent, http and graphql nodes support retries`);
    }
    if (node.retryDelayMs !== undefined) {
      issues.push(`node "${node.id}" sets retryDelayMs but only agent, http and graphql nodes support it`);
    }
    if (node.timeoutMs !== undefined) {
      issues.push(`node "${node.id}" sets timeoutMs but only agent, http and graphql nodes support it`);
    }
  }
  if ((node as { loop?: unknown }).loop && node.type !== 'agent') {
    issues.push(`node "${node.id}" has a loop but only agent nodes may loop`);
  }
  if ((node as { matrix?: unknown }).matrix) {
    if (node.type !== 'agent' && node.type !== 'shell') {
      issues.push(`node "${node.id}" has a matrix but only agent and shell nodes may fan out`);
    }
    if ((node as { loop?: unknown }).loop) {
      issues.push(`node "${node.id}" cannot combine matrix with loop`);
    }
  }
}

function hasCycle(config: ProjectConfig): boolean {
  return graphHasCycle(
    config.workflow.nodes.map((n) => ({ id: n.id, dependsOn: n.dependsOn ?? [] })),
  );
}

function hasSubWorkflowCycle(workflows: Record<string, { nodes: Array<{ type: string; workflow?: string }> }>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const node of workflows[key]?.nodes ?? []) {
      if (node.type === 'workflow' && node.workflow) {
        if (visit(node.workflow)) return true;
      }
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  };

  return Object.keys(workflows).some((key) => visit(key));
}

function graphHasCycle(
  nodes: Array<{ id: string; dependsOn: string[] }>,
): boolean {
  const deps = new Map<string, string[]>();
  for (const node of nodes) {
    deps.set(node.id, node.dependsOn);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dep of deps.get(id) ?? []) {
      if (visit(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return nodes.some((n) => visit(n.id));
}
