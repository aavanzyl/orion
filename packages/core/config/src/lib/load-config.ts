import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ProjectConfig } from '@orion/models';
import { projectConfigSchema } from './schema.js';
import { assertValidConfig } from './validate.js';
import { ConfigError } from './errors.js';

export const DEFAULT_CONFIG_PATH = '.orion/config.yaml';

/** Parse and validate raw YAML text into a ProjectConfig. */
export function parseProjectConfig(yaml: string): ProjectConfig {
  let raw: unknown;
  try {
    raw = parse(yaml);
  } catch (err) {
    throw new ConfigError('Failed to parse YAML', [
      err instanceof Error ? err.message : String(err),
    ]);
  }

  // Normalize legacy field names before Zod validation.
  normalizeLegacyFields(raw);

  const result = projectConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      'Configuration does not match schema',
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }

  const config = result.data as ProjectConfig;
  assertValidConfig(config);
  return config;
}

/**
 * Converts legacy `columns` → `swimlanes` on the board, and `column` → `swimlane`
 * on workflow nodes so that configs written with the old naming continue to
 * parse correctly.
 */
function normalizeLegacyFields(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const obj = raw as Record<string, unknown>;

  if (obj.board && typeof obj.board === 'object' && !Array.isArray(obj.board)) {
    const board = obj.board as Record<string, unknown>;
    if (board.columns && !board.swimlanes) {
      board.swimlanes = board.columns;
      delete board.columns;
    }
  }

  const normalizeNode = (n: Record<string, unknown>) => {
    if (n.column && !n.swimlane) {
      n.swimlane = n.column;
      delete n.column;
    }
  };

  if (obj.workflow && typeof obj.workflow === 'object' && !Array.isArray(obj.workflow)) {
    const wf = obj.workflow as Record<string, unknown>;
    if (Array.isArray(wf.nodes)) {
      for (const n of wf.nodes) {
        if (n && typeof n === 'object' && !Array.isArray(n)) {
          normalizeNode(n as Record<string, unknown>);
        }
      }
    }
  }

  if (obj.workflows && typeof obj.workflows === 'object' && !Array.isArray(obj.workflows)) {
    for (const wf of Object.values(obj.workflows as Record<string, unknown>)) {
      if (wf && typeof wf === 'object' && !Array.isArray(wf)) {
        const w = wf as Record<string, unknown>;
        if (Array.isArray(w.nodes)) {
          for (const n of w.nodes) {
            if (n && typeof n === 'object' && !Array.isArray(n)) {
              normalizeNode(n as Record<string, unknown>);
            }
          }
        }
      }
    }
  }
}

/**
 * Load the Orion configuration from a checked-out repository directory.
 * `repoDir` is the absolute path to the repo root.
 */
export async function loadProjectConfig(
  repoDir: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<ProjectConfig> {
  const fullPath = join(repoDir, configPath);
  let text: string;
  try {
    text = await readFile(fullPath, 'utf8');
  } catch {
    throw new ConfigError(`Configuration file not found at ${configPath}`);
  }
  return parseProjectConfig(text);
}

/**
 * Read the raw YAML text of a project's config file. Returns `null` when the
 * file does not exist yet (so the UI can offer to create one).
 */
export async function readProjectConfigText(
  repoDir: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<string | null> {
  const fullPath = join(repoDir, configPath);
  try {
    return await readFile(fullPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Load project config from a raw YAML string (e.g. stored in the database).
 * Throws `ConfigError` if the YAML is invalid.
 */
export function loadProjectConfigFromYaml(yaml: string): ProjectConfig {
  return parseProjectConfig(yaml);
}
