import type { ProjectId } from './project.model.js';

export interface BoardConnection {
  id: string;
  projectId: ProjectId;
  provider: string;
  apiKey: string;
  teamId: string;
  stateMap: Record<string, string>;
  enabled: boolean;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertBoardConnectionInput {
  apiKey?: string;
  teamId?: string;
  stateMap?: Record<string, string>;
  enabled?: boolean;
}
