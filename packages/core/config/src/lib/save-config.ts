import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import type { ProjectConfig } from '@orion/models';
import { DEFAULT_CONFIG_PATH, parseProjectConfig } from './load-config.js';

/** Serialize a validated ProjectConfig to YAML text. */
export function serializeProjectConfig(config: ProjectConfig): string {
  return stringify(config, { indent: 2, lineWidth: 0 });
}

/**
 * Validate and write raw YAML text to a project's config file, creating the
 * `.orion` directory if needed. Throws `ConfigError` when the YAML is invalid
 * so a broken config is never persisted.
 */
export async function saveProjectConfigText(
  repoDir: string,
  yaml: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<ProjectConfig> {
  const config = parseProjectConfig(yaml);
  const fullPath = join(repoDir, configPath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, yaml.endsWith('\n') ? yaml : `${yaml}\n`, 'utf8');
  return config;
}

/** Validate and write a structured ProjectConfig to a project's config file. */
export function saveProjectConfig(
  repoDir: string,
  config: ProjectConfig,
  configPath: string = DEFAULT_CONFIG_PATH,
): Promise<ProjectConfig> {
  return saveProjectConfigText(repoDir, serializeProjectConfig(config), configPath);
}

/**
 * Validate a raw YAML string as a ProjectConfig without persisting it to disk.
 * Returns the parsed config on success; throws `ConfigError` on failure.
 * Useful when config is stored in the database.
 */
export function validateProjectConfigYaml(yaml: string): ProjectConfig {
  return parseProjectConfig(yaml);
}
