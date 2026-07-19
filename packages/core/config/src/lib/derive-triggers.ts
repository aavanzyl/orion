import type { ProjectConfig } from '@orion/models';

/**
 * Resolve which workflow should run based on a ticket's issue type. If the
 * project config defines `issueTypes`, the type's linked workflow is used.
 * Falls back to the ticket's explicit `workflowName`, then the top-level
 * `workflow`. Returns the workflow name to select.
 */
export function resolveWorkflowForTicketType(
  config: ProjectConfig,
  ticketType?: string,
  ticketWorkflowName?: string,
): string {
  if (ticketType && config.issueTypes) {
    const mapping = config.issueTypes.find((it) => it.name === ticketType);
    if (mapping) {
      return mapping.workflow;
    }
  }
  if (ticketWorkflowName) {
    return ticketWorkflowName;
  }
  return config.workflow.name;
}

/**
 * Determine which workflow (if any) should auto-start when a ticket enters a
 * swimlane. The workflow is resolved from the ticket's issue type, and it only
 * triggers when one of its starting nodes (nodes with zero dependencies) is
 * associated with the destination swimlane. Returns the workflow name to
 * start, or `null` when the move should not trigger anything.
 */
export function resolveTriggerWorkflowForSwimlane(
  config: ProjectConfig,
  swimlane: string,
  ticketType?: string,
  ticketWorkflowName?: string,
): string | null {
  const name = resolveWorkflowForTicketType(config, ticketType, ticketWorkflowName);
  const isSubWorkflow =
    name !== config.workflow.name && config.workflows?.[name] !== undefined;
  const workflow =
    isSubWorkflow && config.workflows?.[name]
      ? config.workflows[name]
      : config.workflow;
  const startNodes = workflow.nodes.filter((n) => (n.dependsOn ?? []).length === 0);
  return startNodes.some((n) => n.swimlane === swimlane)
    ? (isSubWorkflow ? name : config.workflow.name)
    : null;
}

/**
 * Collect the set of configured issue types for a project, always including
 * `epic` which is implicitly available. When no project-specific issue types
 * are defined, returns the built-in defaults (feature, bug, issue, hotfix, epic).
 */
export function resolveIssueTypes(
  config: ProjectConfig | null,
): { value: string; label: string; workflow?: string }[] {
  if (config?.issueTypes && config.issueTypes.length > 0) {
    return [
      { value: 'epic', label: 'Epic' },
      ...config.issueTypes.map((it) => ({
        value: it.name,
        label: it.label,
        workflow: it.workflow,
      })),
    ];
  }
  return [
    { value: 'feature', label: 'Feature' },
    { value: 'bug', label: 'Bug' },
    { value: 'issue', label: 'Issue' },
    { value: 'hotfix', label: 'Hotfix' },
    { value: 'epic', label: 'Epic' },
  ];
}
