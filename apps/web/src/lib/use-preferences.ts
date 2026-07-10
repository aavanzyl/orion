import { useCallback, useSyncExternalStore } from 'react';
import type { AppPreferences } from '@orion/models';
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
  toasts: boolean;
  desktop: boolean;
  runComplete: boolean;
  runFailed: boolean;
  syncComplete: boolean;
  approvalRequired: boolean;
}

export interface Preferences {
  agentDefaults: AgentDefaults;
  notifications: NotificationPreferences;
}

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
    toasts: true,
    desktop: false,
    runComplete: true,
    runFailed: true,
    syncComplete: false,
    approvalRequired: true,
  },
};

function readLocal(): Preferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        agentDefaults: { ...DEFAULT_PREFERENCES.agentDefaults, ...parsed?.agentDefaults },
        notifications: { ...DEFAULT_PREFERENCES.notifications, ...parsed?.notifications },
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_PREFERENCES;
}

function writeLocal(preferences: Preferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // ignore
  }
}

function mapFromDb(db: AppPreferences): Preferences {
  return {
    agentDefaults: { ...DEFAULT_PREFERENCES.agentDefaults, ...db.agentDefaults },
    notifications: { ...DEFAULT_PREFERENCES.notifications, ...db.notifications },
  };
}

function mapToDb(prefs: Preferences): Partial<AppPreferences> {
  return {
    agentDefaults: { ...prefs.agentDefaults },
    notifications: { ...prefs.notifications },
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

  const setNotifications = useCallback((next: Partial<NotificationPreferences>) => {
    currentPreferences = {
      ...currentPreferences,
      notifications: { ...currentPreferences.notifications, ...next },
    };
    writeLocal(currentPreferences);
    emitChange();
    if (loadedFromDb) {
      persistToDb(currentPreferences);
    }
  }, []);

  return { preferences, setAgentDefaults, setNotifications };
}
