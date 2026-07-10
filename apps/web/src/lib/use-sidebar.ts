import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'orion-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    if (collapsed) {
      localStorage.setItem(STORAGE_KEY, 'true');
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

let currentCollapsed = readCollapsed();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return currentCollapsed;
}

function emitChange() {
  listeners.forEach((cb) => cb());
}

export function useSidebar() {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setCollapsed = useCallback((next: boolean) => {
    currentCollapsed = next;
    writeCollapsed(next);
    emitChange();
  }, []);

  const toggle = useCallback(() => {
    setCollapsed(!currentCollapsed);
  }, [setCollapsed]);

  return { collapsed, setCollapsed, toggle };
}
