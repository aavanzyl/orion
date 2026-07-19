import { useCallback, useSyncExternalStore } from 'react';
import type { AppPreferences, DefaultIssueTypeConfig, NotificationChannelPrefs, NotificationEventKey, NotificationEvents } from '@orion/models';
import { api } from './api';

const STORAGE_KEY = 'orion-preferences';

export interface AgentDefaults {
  providerId: string;
  model: string;
  harness: string;
  concurrency: number;
  timeoutSeconds: number;
  maxRetries: number;
}

export interface NotificationPreferences {
  events: NotificationEvents;
}

export interface Preferences {
  agentDefaults: AgentDefaults;
  notifications: NotificationPreferences;
  issueTypeDefaults: DefaultIssueTypeConfig[];
}

const EVENT_KEYS: NotificationEventKey[] = [
  'runComplete',
  'runFailed',
  'syncComplete',
  'approvalRequired',
  'workflowTriggered',
  'agentRunning',
  'agentFailed',
  'scheduleFired',
  'scheduleCompleted',
  'scheduleFailed',
  'transitionIssue',
  'nodeTransition',
  'sync.completed',
  'sync.failed',
];

const DEFAULT_EVENT_PREFS: Record<string, NotificationChannelPrefs> = {
  runComplete: { toasts: true, desktop: false },
  runFailed: { toasts: true, desktop: false },
  syncComplete: { toasts: false, desktop: false },
  approvalRequired: { toasts: true, desktop: false },
  workflowTriggered: { toasts: false, desktop: false },
  agentRunning: { toasts: false, desktop: false },
  agentFailed: { toasts: true, desktop: false },
  scheduleFired: { toasts: false, desktop: false },
  scheduleCompleted: { toasts: false, desktop: false },
  scheduleFailed: { toasts: true, desktop: false },
  transitionIssue: { toasts: false, desktop: false },
  nodeTransition: { toasts: false, desktop: false },
  'sync.completed': { toasts: false, desktop: false },
  'sync.failed': { toasts: true, desktop: false },
};

const DEFAULT_PREFERENCES: Preferences = {
  agentDefaults: {
    providerId: '',
    model: '',
    harness: '',
    concurrency: 3,
    timeoutSeconds: 600,
    maxRetries: 1,
  },
  notifications: {
    events: { ...DEFAULT_EVENT_PREFS } as NotificationEvents,
  },
  issueTypeDefaults: [
    { name: 'feature', label: 'Feature', workflow: 'default' },
    { name: 'bug', label: 'Bug', workflow: 'default' },
    { name: 'issue', label: 'Issue', workflow: 'default' },
    { name: 'hotfix', label: 'Hotfix', workflow: 'default' },
  ],
};

interface OldFlatNotificationPreferences {
  toasts?: boolean;
  desktop?: boolean;
  runComplete?: boolean;
  runFailed?: boolean;
  syncComplete?: boolean;
  approvalRequired?: boolean;
  workflowTriggered?: boolean;
  agentRunning?: boolean;
  agentFailed?: boolean;
  scheduleFired?: boolean;
  scheduleCompleted?: boolean;
  scheduleFailed?: boolean;
  transitionIssue?: boolean;
  nodeTransition?: boolean;
}

function isOldNotificationFormat(notifs: unknown): notifs is OldFlatNotificationPreferences {
  if (!notifs || typeof notifs !== 'object') return false;
  const n = notifs as Record<string, unknown>;
  return !n.events && (typeof n.toasts === 'boolean' || typeof n.runComplete === 'boolean');
}

function migrateNotifications(oldNotifs: OldFlatNotificationPreferences): NotificationPreferences {
  const globalToasts = oldNotifs.toasts ?? true;
  const globalDesktop = oldNotifs.desktop ?? false;

  const events: NotificationEvents = {} as NotificationEvents;
  for (const key of EVENT_KEYS) {
    const enabled = (oldNotifs as Record<string, boolean | undefined>)[key] ?? DEFAULT_EVENT_PREFS[key].toasts;
    events[key] = {
      toasts: globalToasts && enabled,
      desktop: globalDesktop && enabled,
    };
  }
  return { events };
}

function readLocal(): Preferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (isOldNotificationFormat(parsed?.notifications)) {
        const migratedNotifications = migrateNotifications(parsed.notifications);
        return {
          agentDefaults: { ...DEFAULT_PREFERENCES.agentDefaults, ...parsed?.agentDefaults },
          notifications: migratedNotifications,
          issueTypeDefaults: parsed?.issueTypeDefaults ?? DEFAULT_PREFERENCES.issueTypeDefaults,
        };
      }
    return {
      agentDefaults: { ...DEFAULT_PREFERENCES.agentDefaults, ...parsed?.agentDefaults },
      notifications: {
        events: { ...DEFAULT_EVENT_PREFS, ...parsed?.notifications?.events } as NotificationEvents,
      },
      issueTypeDefaults: parsed?.issueTypeDefaults ?? DEFAULT_PREFERENCES.issueTypeDefaults,
    };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_PREFERENCES, notifications: { events: { ...DEFAULT_EVENT_PREFS } as NotificationEvents } };
}

function writeLocal(preferences: Preferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // ignore
  }
}

function mapFromDb(db: AppPreferences): Preferences {
  if (isOldNotificationFormat(db.notifications)) {
    const migratedNotifications = migrateNotifications(db.notifications);
    return {
      agentDefaults: { ...DEFAULT_PREFERENCES.agentDefaults, ...db.agentDefaults },
      notifications: migratedNotifications,
      issueTypeDefaults: db.issueTypeDefaults ?? DEFAULT_PREFERENCES.issueTypeDefaults,
    };
  }
  return {
    agentDefaults: { ...DEFAULT_PREFERENCES.agentDefaults, ...db.agentDefaults },
    notifications: {
      events: { ...DEFAULT_EVENT_PREFS, ...(db.notifications as unknown as { events?: NotificationEvents })?.events } as NotificationEvents,
    },
    issueTypeDefaults: db.issueTypeDefaults ?? DEFAULT_PREFERENCES.issueTypeDefaults,
  };
}

function mapToDb(prefs: Preferences): Partial<AppPreferences> {
  return {
    agentDefaults: { ...prefs.agentDefaults },
    notifications: { events: { ...prefs.notifications.events } },
    issueTypeDefaults: prefs.issueTypeDefaults,
  };
}

let currentPreferences: Preferences = readLocal();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return currentPreferences;
}

function emitChange() {
  listeners.forEach((cb) => cb());
}

let loadedFromDb = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persistToDb(prefs: Preferences) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.updateSettings({ preferences: mapToDb(prefs) }).catch(() => undefined);
  }, 400);
}

async function loadFromDb() {
  try {
    const settings = await api.getSettings();
    const prefs = mapFromDb(settings.preferences);
    currentPreferences = prefs;
    writeLocal(prefs);
    emitChange();
  } catch {
    // keep local fallback
  } finally {
    loadedFromDb = true;
  }
}

loadFromDb();

export function usePreferences() {
  const preferences = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setAgentDefaults = useCallback((next: Partial<AgentDefaults>) => {
    currentPreferences = {
      ...currentPreferences,
      agentDefaults: { ...currentPreferences.agentDefaults, ...next },
    };
    writeLocal(currentPreferences);
    emitChange();
    if (loadedFromDb) {
      persistToDb(currentPreferences);
    }
  }, []);

  const setNotificationEvent = useCallback(
    (eventKey: NotificationEventKey, next: Partial<NotificationChannelPrefs>) => {
      currentPreferences = {
        ...currentPreferences,
        notifications: {
          events: {
            ...currentPreferences.notifications.events,
            [eventKey]: {
              ...currentPreferences.notifications.events[eventKey],
              ...next,
            },
          },
        },
      };
      writeLocal(currentPreferences);
      emitChange();
      if (loadedFromDb) {
        persistToDb(currentPreferences);
      }
    },
    [],
  );

  const setIssueTypeDefaults = useCallback((next: DefaultIssueTypeConfig[]) => {
    currentPreferences = {
      ...currentPreferences,
      issueTypeDefaults: next,
    };
    writeLocal(currentPreferences);
    emitChange();
    if (loadedFromDb) {
      persistToDb(currentPreferences);
    }
  }, []);

  return { preferences, setAgentDefaults, setNotificationEvent, setIssueTypeDefaults };
}
