import type {
  FetchLike,
  RemoteBoardClient,
  RemoteConnectionConfig,
  RemoteContainer,
  RemoteIssue,
  RemoteState,
} from '@orion/board-core';

interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
}

interface GitHubLabel {
  id: number;
  name: string;
  color: string;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: GitHubLabel[];
  html_url: string;
  pull_request?: unknown;
}

export class GitHubBoardClient implements RemoteBoardClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly repo: string;
  private readonly fetchImpl: FetchLike;

  constructor(token: string, repo: string, fetchImpl?: FetchLike, baseUrl = 'https://api.github.com') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.repo = repo;
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  private async request<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `GitHub ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`,
      );
    }
    return (await res.json()) as T;
  }

  async listContainers(): Promise<RemoteContainer[]> {
    const repos = await this.request<GitHubRepo[]>(
      '/user/repos?per_page=100&sort=updated',
    );
    return repos.map((r) => ({
      id: r.full_name,
      name: r.name,
    }));
  }

  async listStates(containerId: string): Promise<RemoteState[]> {
    const labels = await this.request<GitHubLabel[]>(
      `/repos/${containerId}/labels?per_page=100`,
    );
    return labels.map((l) => ({
      id: l.name,
      name: l.name,
      type: 'label',
    }));
  }

  async listIssues(containerId: string): Promise<RemoteIssue[]> {
    const issues = await this.request<GitHubIssue[]>(
      `/repos/${containerId}/issues?state=all&per_page=100`,
    );
    return issues
      .filter((i) => !i.pull_request)
      .map((i) => ({
        id: String(i.number),
        identifier: `#${i.number}`,
        title: i.title,
        description: i.body ?? '',
        stateId: i.labels[0]?.name ?? i.state,
        stateName: i.labels[0]?.name ?? i.state,
        url: i.html_url,
      }));
  }

  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    await this.request(`/repos/${this.repo}/issues/${issueId}`, {
      method: 'PATCH',
      body: { labels: [stateId] },
    });
  }

  async createComment(issueId: string, body: string): Promise<void> {
    await this.request(`/repos/${this.repo}/issues/${issueId}/comments`, {
      method: 'POST',
      body: { body },
    });
  }
}

export function createGithubClient(
  config: RemoteConnectionConfig,
): RemoteBoardClient {
  if (!config.containerId) {
    throw new Error('GitHub connection requires a repository (containerId)');
  }
  const baseUrl = config.config.baseUrl || undefined;
  return new GitHubBoardClient(config.apiKey, config.containerId, undefined, baseUrl);
}
