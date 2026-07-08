import type { ProjectConfig, WorkflowConfig, WorkflowNodeConfig } from '@orion/models';
import { ConfigError } from './errors.js';

const MAX_DEPTH = 20;

/**
 * Expand every `workflow` node in the project config into its referenced
 * sub-workflow's nodes and remove the `workflows` map. The returned config
 * contains only `agent|approval|scm|shell` nodes.
 */
export function flattenProjectConfig(config: ProjectConfig): ProjectConfig {
  if (!config.workflows) return config;

  return {
    ...config,
    workflows: undefined,
    workflow: flattenWorkflow(config.workflow.nodes, config.workflows, 0, new Set()),
  };
}

/**
 * Recursively expand `workflow` nodes in a node list into their sub-workflows.
 * Node ids are preserved; the author must ensure global uniqueness.
 */
export function flattenWorkflow(
  nodes: WorkflowNodeConfig[],
  workflows: Record<string, WorkflowConfig>,
  depth: number,
  visiting: Set<string>,
): WorkflowConfig {
  if (depth > MAX_DEPTH) {
    throw new ConfigError(`max sub-workflow depth (${MAX_DEPTH}) exceeded`);
  }

  const result: WorkflowNodeConfig[] = [];
  const rewires: Array<{ workflowNodeId: string; leafIds: string[] }> = [];

  for (const node of nodes) {
    if (node.type !== 'workflow') {
      result.push({ ...node });
      continue;
    }

    if (!node.workflow) {
      throw new ConfigError(`workflow node "${node.id}" has no workflow reference`);
    }

    if (visiting.has(node.workflow)) {
      throw new ConfigError(
        `sub-workflow cycle detected: "${node.workflow}" transitively includes itself`,
      );
    }

    const sub = workflows[node.workflow];
    if (!sub) {
      throw new ConfigError(
        `sub-workflow "${node.workflow}" not found (referenced by node "${node.id}")`,
      );
    }

    visiting.add(node.workflow);
    const flatChildren = flattenWorkflow(sub.nodes, workflows, depth + 1, visiting).nodes;
    visiting.delete(node.workflow);

    const allSubIds = new Set(flatChildren.map((n) => n.id));
    const dependedOn = new Set<string>();
    for (const sn of flatChildren) {
      for (const d of sn.dependsOn ?? []) {
        if (allSubIds.has(d)) dependedOn.add(d);
      }
    }
    const leafIds = flatChildren.filter((n) => !dependedOn.has(n.id)).map((n) => n.id);
    const workflowNodeDeps = node.dependsOn ?? [];

    for (const sn of flatChildren) {
      if ((!sn.dependsOn || sn.dependsOn.length === 0) && workflowNodeDeps.length > 0) {
        sn.dependsOn = [...workflowNodeDeps];
      }
    }

    rewires.push({
      workflowNodeId: node.id,
      leafIds: leafIds.length > 0 ? leafIds : [...allSubIds],
    });

    result.push(...flatChildren);
  }

  if (rewires.length > 0) {
    for (const rn of result) {
      const deps = rn.dependsOn;
      if (!deps) continue;
      for (const { workflowNodeId, leafIds } of rewires) {
        if (deps.includes(workflowNodeId)) {
          rn.dependsOn = deps.flatMap((d) => (d === workflowNodeId ? leafIds : [d]));
        }
      }
    }
  }

  const topWorkflow = nodes.length > 0
    ? { name: 'expanded', nodes: result }
    : { name: 'expanded', nodes: result };

  return topWorkflow;
}
