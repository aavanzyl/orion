import type {
  FetchLike,
  RemoteBoardClient,
  RemoteConnectionConfig,
  RemoteContainer,
  RemoteIssue,
  RemoteState,
} from '@orion/board-core';

interface JiraProjectSearch {
  values?: { id: string; key: string; name: string }[];
}

interface JiraStatusCategoryGroup {
  statuses?: { id: string; name: string; statusCategory?: { key?: string } }[];
}

interface JiraTransitions {
  transitions?: { id: string; to?: { id?: string } }[];
}

interface JiraSearchResult {
  issues?: {
    id: string;
    key: string;
    fields?: {
      summary?: string;
      description?: unknown;
      status?: { id?: string; name?: string };
    };
  }[];
}

/** Minimal Atlassian Document Format node shape for text extraction. */
interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

/** Recursively collect plain text out of an ADF document. */
export function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return typeof node === 'string' ? node : '';
  const n = node as AdfNode;
  if (n.type === 'text' && typeof n.text === 'string') return n.text;
  if (Array.isArray(n.content)) {
    const parts = n.content.map(adfToText);
    const joiner = n.type === 'paragraph' ? '' : '\n';
    return parts.join(joiner);
  }
  return '';
}

/** Wrap plain text as a minimal ADF document (for comments/updates). */
export function textToAdf(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

/**
 * Jira Cloud REST v3 client normalized onto {@link RemoteBoardClient}. Jira
 * "projects" are containers and issue statuses are the states. Auth is HTTP
 * Basic using `email:apiToken`.
 */
export class JiraBoardClient implements RemoteBoardClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    opts: { baseUrl: string; email: string; apiToken: string },
    fetchImpl?: FetchLike,
  ) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.authHeader =
      'Basic ' + Buffer.from(`${opts.email}:${opts.apiToken}`).toString('base64');
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  private async request<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Jira ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async listContainers(): Promise<RemoteContainer[]> {
    const data = await this.request<JiraProjectSearch>(
      '/rest/api/3/project/search?maxResults=100',
    );
    return (data.values ?? []).map((p) => ({ id: p.key, name: p.name, key: p.key }));
  }

  async listStates(containerId: string): Promise<RemoteState[]> {
    const groups = await this.request<JiraStatusCategoryGroup[]>(
      `/rest/api/3/project/${encodeURIComponent(containerId)}/statuses`,
    );
    const seen = new Map<string, RemoteState>();
    for (const group of groups) {
      for (const s of group.statuses ?? []) {
        if (!seen.has(s.id)) {
          seen.set(s.id, { id: s.id, name: s.name, type: s.statusCategory?.key });
        }
      }
    }
    return [...seen.values()];
  }

  async listIssues(containerId: string): Promise<RemoteIssue[]> {
    const jql = `project = "${containerId}" ORDER BY updated DESC`;
    const data = await this.request<JiraSearchResult>('/rest/api/3/search', {
      method: 'POST',
      body: { jql, maxResults: 100, fields: ['summary', 'description', 'status'] },
    });
    return (data.issues ?? []).map((issue) => ({
      id: issue.id,
      identifier: issue.key,
      title: issue.fields?.summary ?? '',
      description: adfToText(issue.fields?.description),
      stateId: issue.fields?.status?.id ?? '',
      stateName: issue.fields?.status?.name ?? '',
      url: `${this.baseUrl}/browse/${issue.key}`,
    }));
  }

  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    const data = await this.request<JiraTransitions>(
      `/rest/api/3/issue/${encodeURIComponent(issueId)}/transitions`,
    );
    const transition = (data.transitions ?? []).find((t) => t.to?.id === stateId);
    if (!transition) return;
    await this.request(`/rest/api/3/issue/${encodeURIComponent(issueId)}/transitions`, {
      method: 'POST',
      body: { transition: { id: transition.id } },
    });
  }

  async createComment(issueId: string, body: string): Promise<void> {
    await this.request(`/rest/api/3/issue/${encodeURIComponent(issueId)}/comment`, {
      method: 'POST',
      body: { body: textToAdf(body) },
    });
  }
}

/** Provider factory registered under the `jira` key. */
export function createJiraClient(config: RemoteConnectionConfig): RemoteBoardClient {
  const baseUrl = config.config.baseUrl ?? '';
  const email = config.config.email ?? '';
  if (!baseUrl) throw new Error('Jira connection requires config.baseUrl');
  if (!email) throw new Error('Jira connection requires config.email');
  return new JiraBoardClient({ baseUrl, email, apiToken: config.apiKey });
}
