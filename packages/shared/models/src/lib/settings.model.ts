export interface AppBranding {
  title: string;
  accent: string;
  logo?: string | null;
}

/** A default issue type configuration stored in app settings. */
export interface DefaultIssueTypeConfig {
  name: string;
  label: string;
  workflow: string;
  color?: string;
  icon?: string;
}

export interface AgentDefaults {
  providerId?: string;
  model?: string;
  harness?: string;
  concurrency?: number;
  timeoutSeconds?: number;
  maxRetries?: number;
}

export interface NotificationChannelPrefs {
  toasts: boolean;
  desktop: boolean;
}

export type NotificationEventKey =
  | 'runComplete'
  | 'runFailed'
  | 'syncComplete'
  | 'approvalRequired'
  | 'workflowTriggered'
  | 'agentRunning'
  | 'agentFailed'
  | 'scheduleFired'
  | 'scheduleCompleted'
  | 'scheduleFailed'
  | 'transitionIssue'
  | 'nodeTransition'
  | 'sync.completed'
  | 'sync.failed';

export type NotificationEvents = Record<NotificationEventKey, NotificationChannelPrefs>;

export interface AppPreferences {
  agentDefaults: AgentDefaults;
  notifications: {
    events: NotificationEvents;
  };
  issueTypeDefaults?: DefaultIssueTypeConfig[];
}

export interface AppSettings {
  branding: AppBranding;
  preferences: AppPreferences;
}
