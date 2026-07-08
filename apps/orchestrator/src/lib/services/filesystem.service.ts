import { readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Container } from '../container.js';

export interface DirEntry {
  name: string;
  path: string;
}

export interface BrowseResult {
  /** The browse root. Nothing outside this directory is listed. */
  root: string;
  /** The directory whose child directories are returned. */
  dir: string;
  entries: DirEntry[];
}

const MAX_ENTRIES = 200;
const READ_TIMEOUT_MS = 8000;

/** Is `child` the same as, or nested inside, `root`? */
function isWithin(root: string, child: string): boolean {
  if (child === root) return true;
  const rel = relative(root, child);
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Reject if the underlying (uncancellable) fs work outlives the budget. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((res, rej) => {
    const timer = setTimeout(() => rej(new Error('Directory listing timed out')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        res(value);
      },
      (err) => {
        clearTimeout(timer);
        rej(err);
      },
    );
  });
}

/**
 * Lists directories on the server so the web UI can offer a path-autocomplete
 * for `local` and `workspace` projects. Browsing is confined to a configured
 * root so no path outside it can be enumerated.
 */
export class FilesystemService {
  constructor(private readonly c: Container) {}

  private get root(): string {
    return this.c.env.projectsDir;
  }

  /**
   * Resolve the query into a directory to list plus an optional name prefix,
   * then return the child directories that match.
   */
  async browse(input: string): Promise<BrowseResult> {
    const root = this.root;
    const query = (input ?? '').trim();

    let dir: string;
    let prefix: string;
    if (!query) {
      dir = root;
      prefix = '';
    } else if (query.endsWith('/') || query.endsWith(sep)) {
      dir = resolve(query);
      prefix = '';
    } else {
      dir = resolve(dirname(query));
      prefix = basename(query);
    }

    // Never escape the root.
    if (!isWithin(root, dir)) {
      dir = root;
      prefix = '';
    }

    let names: string[];
    try {
      // Only the Dirent type is inspected (no per-entry stat) so a slow mount
      // costs a single readdir; symlinks are included optimistically.
      const dirents = await withTimeout(readdir(dir, { withFileTypes: true }), READ_TIMEOUT_MS);
      names = dirents
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith('.') || prefix.startsWith('.'));
    } catch {
      return { root, dir, entries: [] };
    }

    const lowered = prefix.toLowerCase();
    const entries = names
      .filter((name) => name.toLowerCase().startsWith(lowered))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_ENTRIES)
      .map((name) => ({ name, path: join(dir, name) }));

    return { root, dir, entries };
  }
}
