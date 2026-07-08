import { LinearClient } from '@linear/sdk';

export interface LinearIssueDTO {
  id: string;
  identifier: string;
  title: string;
  description: string;
  stateId: string;
  stateName: string;
  url: string;
}

export interface LinearWorkflowStateDTO {
  id: string;
  name: string;
  type: string;
}

export interface LinearTeamDTO {
  id: string;
  name: string;
  key: string;
}

export interface LinearClientLike {
  listIssues(teamId: string): Promise<LinearIssueDTO[]>;
  listWorkflowStates(teamId: string): Promise<LinearWorkflowStateDTO[]>;
  listTeams(): Promise<LinearTeamDTO[]>;
  updateIssueState(issueId: string, stateId: string): Promise<void>;
  createComment(issueId: string, body: string): Promise<void>;
}

export class LinearBoardClient implements LinearClientLike {
  private readonly client: LinearClient;

  constructor(apiKey: string) {
    this.client = new LinearClient({ apiKey });
  }

  async listIssues(teamId: string): Promise<LinearIssueDTO[]> {
    const response = await this.client.issues({
      filter: { team: { id: { eq: teamId } } },
      first: 250,
    });
    return response.nodes.map((issue) => {
      const stateData = (
        issue as unknown as { _state?: { id?: string; name?: string } }
      )._state;
      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? '',
        stateId: stateData?.id ?? '',
        stateName: stateData?.name ?? '',
        url: issue.url,
      };
    });
  }

  async listWorkflowStates(teamId: string): Promise<LinearWorkflowStateDTO[]> {
    const response = await this.client.workflowStates({
      filter: { team: { id: { eq: teamId } } },
      first: 250,
    });
    return response.nodes.map((ws) => {
      const wsData = ws as { id: string; name: string; type: string };
      return {
        id: wsData.id,
        name: wsData.name,
        type: wsData.type,
      };
    });
  }

  async listTeams(): Promise<LinearTeamDTO[]> {
    const response = await this.client.teams({ first: 250 });
    return response.nodes.map((team) => ({
      id: team.id,
      name: team.name,
      key: team.key,
    }));
  }

  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    await this.client.updateIssue(issueId, { stateId });
  }

  async createComment(issueId: string, body: string): Promise<void> {
    await this.client.createComment({ issueId, body });
  }
}
