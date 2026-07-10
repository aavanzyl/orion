import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DEFAULT_CONFIG_PATH } from './load-config.js';
import { ConfigError } from './errors.js';
import { resolveNodeReference } from './resolve-ref.js';

export { resolveNodeReference } from './resolve-ref.js';

export type CommandVariables = Record<string, string>;

const NODES_REF_RE = /\{\{\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_-]+)((?:\.[A-Za-z0-9_]+)*)\s*\}\}/g;

/**
 * Interpolate `{{ <root>.<path...> }}` references against a resolution scope,
 * where `<root>` is any key of the scope (e.g. `nodes`, `matrix`). Missing
 * references are left untouched; objects are JSON-serialized, strings kept as-is.
 */
function interpolateRefs(
  template: string,
  scope: Record<string, unknown>,
): string {
  return template.replace(NODES_REF_RE, (_match, root: string, head: string, dotPath: string) => {
    if (!(root in scope)) return _match;
    const container = scope[root];
    if (container === null || container === undefined || typeof container !== 'object') return _match;
    const segments = dotPath ? dotPath.replace(/^\./, '').split('.') : [];
    const resolved = resolveNodeReference(container as Record<string, unknown>, head, segments);
    if (resolved === undefined) return _match;
    if (typeof resolved === 'string') return resolved;
    return JSON.stringify(resolved);
  });
}

/**
 * Substitute `$VARIABLE` and `${VARIABLE}` tokens in a command template.
 * Unknown variables are left untouched so partial templates remain readable.
 *
 * An optional `nodeOutputs` map enables `{{ nodes.<id>[.<dotpath>] }}`
 * references to upstream node outputs. An optional `scope` supplies additional
 * `{{ <root>.<path> }}` roots (e.g. `{{ matrix.item }}`) beyond `nodes`.
 */
export function renderTemplate(
  template: string,
  variables: CommandVariables,
  nodeOutputs?: Record<string, unknown>,
  scope?: Record<string, unknown>,
): string {
  let result = template.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (match, name: string) => {
    return name in variables ? variables[name] : match;
  });
  if (nodeOutputs || scope) {
    result = interpolateRefs(result, { nodes: nodeOutputs ?? {}, ...scope });
  }
  return result;
}

/**
 * Load a command template referenced by an agent/workflow node. Command paths
 * are resolved relative to the `.orion/` directory (the config file's folder).
 */
export async function loadCommand(
  repoDir: string,
  commandPath: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<string> {
  const orionDir = join(repoDir, dirname(configPath));
  return readFile(join(orionDir, commandPath), 'utf8');
}

/** Load and render a command template in one step. */
export async function renderCommand(
  repoDir: string,
  commandPath: string,
  variables: CommandVariables,
  configPath?: string,
  nodeOutputs?: Record<string, unknown>,
  scope?: Record<string, unknown>,
): Promise<string> {
  const resolvedConfigPath = configPath ?? DEFAULT_CONFIG_PATH;
  const template = await loadCommand(repoDir, commandPath, resolvedConfigPath);
  return renderTemplate(template, variables, nodeOutputs, scope);
}

/** The absolute `.orion/` directory (the config file's folder). */
function orionDir(repoDir: string, configPath: string): string {
  return resolve(join(repoDir, dirname(configPath)));
}

/**
 * Resolve a command path against the `.orion/` directory, rejecting anything
 * that escapes it so the API can never read or write outside the config folder.
 */
function resolveCommandPath(repoDir: string, commandPath: string, configPath: string): string {
  const base = orionDir(repoDir, configPath);
  const target = resolve(join(base, commandPath));
  const rel = relative(base, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ConfigError(`Command path escapes the .orion directory: ${commandPath}`);
  }
  return target;
}

/**
 * Read a command template's text, or `null` when the file does not exist yet
 * (so the UI can offer to create it).
 */
export async function readCommandText(
  repoDir: string,
  commandPath: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<string | null> {
  const target = resolveCommandPath(repoDir, commandPath, configPath);
  try {
    return await readFile(target, 'utf8');
  } catch {
    return null;
  }
}

/** Write a command template's text, creating parent directories as needed. */
export async function saveCommandText(
  repoDir: string,
  commandPath: string,
  content: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<void> {
  const target = resolveCommandPath(repoDir, commandPath, configPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

/**
 * List command template files (`.md`) under the `.orion/` directory, returned as
 * paths relative to that directory (e.g. `commands/implement.md`). Used to power
 * autocomplete in the config wizard.
 */
export async function listCommandFiles(
  repoDir: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<string[]> {
  const base = orionDir(repoDir, configPath);
  const found: string[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 5) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        found.push(relative(base, full));
      }
    }
  };

  await walk(base, 0);
  return found.sort((a, b) => a.localeCompare(b));
}
