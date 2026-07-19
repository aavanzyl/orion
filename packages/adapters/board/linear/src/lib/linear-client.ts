import { LinearClient } from '@linear/sdk';

export interface LinearIssueDTO {
  id: string;
  identifier: string;
  title: string;
  description: string;
  stateId: string;
  stateName: string;
  url: string;
  priority?: number;
  dueDate?: string;
  startedAt?: string;
  labels?: Array<{ name: string; color?: string }>;
  epic?: { id: string; name: string; color?: string };
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

const PAGE_SIZE = 50;

const ISSUES_QUERY = `
  query OrionIssues($teamId: ID!, $first: Int!, $after: String) {
    issues(filter: { team: { id: { eq: $teamId } } }, first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        identifier
        title
        description
        url
        priority
        dueDate
        startedAt
        state {
          id
          name
        }
        labels {
          nodes {
            name
            color
          }
        }
        project {
          id
          name
          color
        }
      }
    }
  }
`;

interface RawIssuesResponse {
  issues: {
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    nodes: Array<{
      id: string;
      identifier: string;
      title: string;
      description?: string | null;
      url: string;
      priority?: number | null;
      dueDate?: string | null;
      startedAt?: string | null;
      state?: { id: string; name: string } | null;
      labels?: { nodes?: Array<{ name: string; color?: string | null }> } | null;
      project?: { id: string; name: string; color?: string | null } | null;
    }>;
  };
}

export class LinearBoardClient implements LinearClientLike {
  private readonly client: LinearClient;

  constructor(apiKey: string) {
    this.client = new LinearClient({ apiKey });
  }

  async listIssues(teamId: string): Promise<LinearIssueDTO[]> {
    const result: LinearIssueDTO[] = [];
    let after: string | undefined;

    do {
      const response = await this.client.client.rawRequest<RawIssuesResponse, Record<string, unknown>>(
        ISSUES_QUERY,
        { teamId, first: PAGE_SIZE, after: after ?? null },
      );
      const page = response.data?.issues;
      if (!page) break;

      for (const issue of page.nodes) {
        const prio =
          typeof issue.priority === 'number' && issue.priority >= 0 && issue.priority <= 4
            ? issue.priority
            : undefined;
        result.push({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description ?? '',
          stateId: issue.state?.id ?? '',
          stateName: issue.state?.name ?? '',
          url: issue.url,
          priority: prio,
          dueDate: issue.dueDate ? String(issue.dueDate).split('T')[0] : undefined,
          startedAt: issue.startedAt ?? undefined,
          labels: issue.labels?.nodes?.map((n) => ({ name: n.name, color: n.color ?? undefined })),
          epic:
            issue.project && issue.project.id && issue.project.name
              ? {
                  id: issue.project.id,
                  name: issue.project.name,
                  color: issue.project.color ?? undefined,
                }
              : undefined,
        });
      }
      after = page.pageInfo.hasNextPage ? (page.pageInfo.endCursor ?? undefined) : undefined;
    } while (after);

    return result;
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
