export interface AppBranding {
  title: string;
  accent: string;
  logo?: string | null;
}

export interface AgentDefaults {
  providerId?: string;
  model?: string;
  harness?: string;
  concurrency?: number;
  timeoutSeconds?: number;
  maxRetries?: number;
}

export interface AppPreferences {
  agentDefaults: AgentDefaults;
  notifications: {
    toasts: boolean;
    desktop: boolean;
    runComplete: boolean;
    runFailed: boolean;
    syncComplete: boolean;
    approvalRequired: boolean;
  };
}

export interface AppSettings {
  branding: AppBranding;
  preferences: AppPreferences;
}
