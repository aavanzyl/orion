import { readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

export interface WalkOptions {
  /** Skip files larger than this many bytes (default 256 KiB). */
  maxFileBytes?: number;
  /** Stop after collecting this many files (default 5000). */
  maxFiles?: number;
  /** Additional directory names to skip. */
  extraSkipDirs?: string[];
}

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'out-tsc',
  '.nx',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'vendor',
  'target',
  '.idea',
  '.vscode',
  'test-output',
]);

/** File extensions treated as indexable text (code + docs + config). */
const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.txt',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.swift',
  '.scala',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.env',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.vue',
  '.svelte',
  '.graphql',
  '.proto',
]);

/** Files without a useful extension that should still be indexed. */
const ALLOWED_FILENAMES = new Set([
  'Dockerfile',
  'Makefile',
  'README',
  'LICENSE',
]);

const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MAX_FILES = 5000;

function isIndexable(name: string): boolean {
  if (ALLOWED_FILENAMES.has(name)) return true;
  return ALLOWED_EXTENSIONS.has(extname(name).toLowerCase());
}

/**
 * Recursively list indexable text files under `rootDir`, skipping VCS, build,
 * dependency and cache directories, binary/non-allowlisted extensions, and
 * files over the size cap. Bounded by `maxFiles` to avoid runaway walks.
 * Returned paths are relative to `rootDir` and POSIX-normalized.
 */
export async function walkRepo(rootDir: string, opts: WalkOptions = {}): Promise<string[]> {
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const skipDirs = new Set([...SKIP_DIRS, ...(opts.extraSkipDirs ?? [])]);

  const results: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    if (results.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        if (!isIndexable(entry.name)) continue;
        try {
          const info = await stat(full);
          if (info.size > maxFileBytes || info.size === 0) continue;
        } catch {
          continue;
        }
        results.push(relative(rootDir, full).split('\\').join('/'));
      }
    }
  };

  await walk(rootDir);
  return results;
}
