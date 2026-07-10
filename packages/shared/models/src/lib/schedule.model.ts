import type { McpServerMap } from './config.model.js';
import type { ProjectId } from './project.model.js';

export type ScheduleId = string;

/**
 * A schedule runs a single agent turn on a recurring cron schedule with a custom
 * instruction. It has nothing to do with the board pipeline, but the agent is
 * always given access to the board (tickets) and codebase MCP servers, plus any
 * skills and registered MCP servers the schedule selects. Schedules are
 * operational config stored in the database (not in `.orion/config.yaml`).
 */
export interface Schedule {
  id: ScheduleId;
  projectId: ProjectId;
  name: string;
  enabled: boolean;
  /** Standard 5-field cron expression. */
  cron: string;
  /** Custom instruction the agent runs on each fire. */
  instruction: string;
  /**
   * Names of skills to materialize for the agent. Resolved against the project
   * skill catalog (built-in defaults + global + project `.orion/skills/`).
   */
  skills: string[];
  /**
   * Names of registered MCP servers to expose to the agent. Resolved against the
   * project config's `mcpServers` map, falling back to `mcpServerConfigs` for
   * servers (e.g. global ones) that are not present in the project config. The
   * built-in board (tickets) and codebase MCP servers are always injected
   * regardless of this list.
   */
  mcpServers: string[];
  /**
   * Inline MCP server definitions keyed by name, captured for any selected
   * server that does not live in the project config (e.g. global servers stored
   * only in the browser). Used as a fallback when resolving `mcpServers`.
   */
  mcpServerConfigs?: McpServerMap;
  /** When the schedule last fired, if ever. */
  lastFiredAt?: string;
  /** When the schedule will next fire. */
  nextFireAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleInput {
  projectId: ProjectId;
  name: string;
  cron: string;
  instruction: string;
  enabled?: boolean;
  skills?: string[];
  mcpServers?: string[];
  mcpServerConfigs?: McpServerMap;
}

/** Mutable fields of a schedule. All optional — only provided fields change. */
export interface UpdateScheduleInput {
  name?: string;
  enabled?: boolean;
  cron?: string;
  instruction?: string;
  skills?: string[];
  mcpServers?: string[];
  mcpServerConfigs?: McpServerMap;
}

/**
 * The skills and MCP servers a schedule can choose from for a given project,
 * used to populate the schedule editor. Skill names come from the project skill
 * catalog merged with global skills; MCP server names come from the project
 * config's `mcpServers` map plus global MCP servers and built-in servers.
 */
export interface ScheduleOptions {
  skills: string[];
  mcpServers: string[];
  /** Global MCP server names stored in the database. */
  globalMcpServers: string[];
}
