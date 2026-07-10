import { useCallback, useSyncExternalStore } from 'react';
import { api } from './api';

const STORAGE_KEY = 'orion-branding';
const DEFAULT_TITLE = 'Orion';

export const ACCENT_PRESETS = {
  blue: { label: 'Blue', hue: 240 },
  violet: { label: 'Violet', hue: 290 },
  teal: { label: 'Teal', hue: 185 },
  green: { label: 'Green', hue: 150 },
  amber: { label: 'Amber', hue: 70 },
  rose: { label: 'Rose', hue: 15 },
} as const;

export type AccentKey = keyof typeof ACCENT_PRESETS;

const DEFAULT_ACCENT: AccentKey = 'blue';

interface Branding {
  title: string;
  accent: AccentKey;
  logo?: string | null;
}

function isAccentKey(value: unknown): value is AccentKey {
  return typeof value === 'string' && value in ACCENT_PRESETS;
}

function readLocal(): Branding {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const title =
        parsed && typeof parsed.title === 'string' && parsed.title.trim()
          ? parsed.title.trim()
          : DEFAULT_TITLE;
      const accent = isAccentKey(parsed?.accent) ? parsed.accent : DEFAULT_ACCENT;
      const logo = parsed?.logo ?? null;
      return { title, accent, logo };
    }
  } catch {
    // ignore
  }
  return { title: DEFAULT_TITLE, accent: DEFAULT_ACCENT, logo: null };
}

function writeLocal(branding: Branding) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(branding));
  } catch {
    // ignore
  }
}

let currentBranding: Branding = readLocal();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return currentBranding;
}

function emitChange() {
  listeners.forEach((cb) => cb());
}

let loadedFromDb = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persistToDb(branding: Branding) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.updateSettings({ branding }).catch(() => undefined);
  }, 400);
}

async function loadFromDb() {
  try {
    const settings = await api.getSettings();
    const { branding: db } = settings;
    const title =
      db && typeof db.title === 'string' && db.title.trim()
        ? db.title.trim()
        : DEFAULT_TITLE;
    const accent = isAccentKey(db?.accent) ? db.accent : DEFAULT_ACCENT;
    const logo = db?.logo ?? null;
    currentBranding = { title, accent, logo };
    writeLocal(currentBranding);
    emitChange();
  } catch {
    // keep local fallback
  } finally {
    loadedFromDb = true;
  }
}

loadFromDb();

export function useBranding() {
  const branding = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setBranding = useCallback((next: Partial<Branding>) => {
    currentBranding = { ...currentBranding, ...next };
    writeLocal(currentBranding);
    emitChange();
    if (loadedFromDb) {
      persistToDb(currentBranding);
    }
  }, []);

  return { branding, setBranding };
}
