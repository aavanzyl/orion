import type { ProjectId } from './project.model.js';

/** Which way tickets flow between Orion and the external board. */
export type BoardSyncDirection = 'pull' | 'push' | 'both';

/** Providers that can back a board connection. */
export type BoardConnectionProvider = 'linear' | 'jira' | 'trello' | 'github';

export type BoardSyncLogStatus = 'completed' | 'failed';
export type BoardSyncTrigger = 'manual' | 'auto';

export interface BoardSyncLog {
  id: string;
  projectId: ProjectId;
  startedAt: string;
  finishedAt: string;
  status: BoardSyncLogStatus;
  imported: number;
  updated: number;
  epicsLinked: number;
  error: string | null;
  durationMs: number;
  trigger: BoardSyncTrigger;
}

export interface BoardConnection {
  id: string;
  projectId: ProjectId;
  provider: string;
  /** Primary secret (Linear key / Jira token / Trello token). Never exposed by the API. */
  apiKey: string;
  /** Team (Linear) / project key (Jira) / board id (Trello). */
  teamId: string;
  /** Non-secret provider extras: Jira `baseUrl`/`email`, Trello `key`, ... */
  config: Record<string, string>;
  /** Maps Orion swimlane keys to remote state ids (and vice versa). */
  stateMap: Record<string, string>;
  /** Direction of sync. `both` pulls remote issues and pushes local moves. */
  direction: BoardSyncDirection;
  /** Push a ticket's state upstream the moment it moves locally. */
  autoPush: boolean;
  /** Import remote issues that don't yet exist locally. */
  importNew: boolean;
  /** Update local tickets when their remote source changes. */
  updateExisting: boolean;
  /** Per-connection sync cadence in ms; falls back to the global default. */
  syncIntervalMs?: number;
  enabled: boolean;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertBoardConnectionInput {
  provider?: string;
  apiKey?: string;
  teamId?: string;
  config?: Record<string, string>;
  stateMap?: Record<string, string>;
  direction?: BoardSyncDirection;
  autoPush?: boolean;
  importNew?: boolean;
  updateExisting?: boolean;
  /** `null` clears the override and reverts to the global cadence. */
  syncIntervalMs?: number | null;
  enabled?: boolean;
}
