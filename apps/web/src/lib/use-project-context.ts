import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'orion-selected-project-id';

function readProjectId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeProjectId(id: string | null) {
  try {
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

let currentProjectId = readProjectId();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return currentProjectId;
}

function emitChange() {
  listeners.forEach((cb) => cb());
}

export function useProjectContext() {
  const projectId = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setProjectId = useCallback((next: string | null) => {
    currentProjectId = next;
    writeProjectId(next);
    emitChange();
  }, []);

  return { projectId, setProjectId };
}
