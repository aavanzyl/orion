import type {
  RemoteBoardClient,
  RemoteConnectionConfig,
  RemoteContainer,
  RemoteIssue,
  RemoteState,
} from '@orion/board-core';
import { LinearBoardClient, type LinearClientLike } from './linear-client.js';

/**
 * Adapts the Linear SDK client onto the provider-agnostic {@link RemoteBoardClient}.
 * Linear "teams" are the containers and "workflow states" are the states.
 */
export class LinearRemoteBoardClient implements RemoteBoardClient {
  private readonly client: LinearClientLike;

  constructor(apiKey: string, client?: LinearClientLike) {
    this.client = client ?? new LinearBoardClient(apiKey);
  }

  async listContainers(): Promise<RemoteContainer[]> {
    const teams = await this.client.listTeams();
    return teams.map((t) => ({ id: t.id, name: t.name, key: t.key }));
  }

  async listStates(containerId: string): Promise<RemoteState[]> {
    const states = await this.client.listWorkflowStates(containerId);
    return states.map((s) => ({ id: s.id, name: s.name, type: s.type }));
  }

  async listIssues(containerId: string): Promise<RemoteIssue[]> {
    return this.client.listIssues(containerId);
  }

  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    await this.client.updateIssueState(issueId, stateId);
  }

  async createComment(issueId: string, body: string): Promise<void> {
    await this.client.createComment(issueId, body);
  }
}

/** Provider factory registered under the `linear` key. */
export function createLinearClient(config: RemoteConnectionConfig): RemoteBoardClient {
  return new LinearRemoteBoardClient(config.apiKey);
}
