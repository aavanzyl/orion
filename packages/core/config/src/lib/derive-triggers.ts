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
