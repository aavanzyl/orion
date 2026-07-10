import type { ProjectConfig, WorkflowConfig } from '@orion/models';

/**
 * The swimlane a workflow is "triggered" from is the swimlane of its entry node
 * — the first node that nothing else depends on being reached first, i.e. a node
 * with no `dependsOn`. When every node declares a dependency (unusual), the
 * first node in declaration order is used as a fallback.
 */
export function entrySwimlane(workflow: WorkflowConfig): string | undefined {
  const entry =
    workflow.nodes.find((n) => !n.dependsOn || n.dependsOn.length === 0) ??
    workflow.nodes[0];
  return entry?.swimlane;
}

/**
 * Derive the swimlane → workflow-name(s) trigger map from the project's
 * workflows. A workflow is auto-started when a ticket enters the swimlane of its
 * entry node. Both the top-level `workflow` and every named entry in `workflows`
 * are considered. Multiple workflows can share a swimlane; callers disambiguate
 * (e.g. via the ticket's chosen `workflowName`).
 */
export function deriveSwimlaneTriggers(config: ProjectConfig): Record<string, string[]> {
  const triggers: Record<string, string[]> = {};

  const add = (name: string, workflow: WorkflowConfig) => {
    const swimlane = entrySwimlane(workflow);
    if (!swimlane) return;
    const bucket = (triggers[swimlane] ??= []);
    if (!bucket.includes(name)) bucket.push(name);
  };

  add(config.workflow.name, config.workflow);
  for (const [name, workflow] of Object.entries(config.workflows ?? {})) {
    add(name, workflow);
  }

  return triggers;
}
