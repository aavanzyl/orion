import type {
  FetchLike,
  RemoteBoardClient,
  RemoteConnectionConfig,
  RemoteContainer,
  RemoteIssue,
  RemoteState,
} from '@orion/board-core';

interface TrelloBoard {
  id: string;
  name: string;
}

interface TrelloList {
  id: string;
  name: string;
}

interface TrelloCard {
  id: string;
  idShort?: number;
  name: string;
  desc?: string;
  idList: string;
  shortUrl?: string;
}

const TRELLO_BASE = 'https://api.trello.com/1';

/**
 * Trello REST client normalized onto {@link RemoteBoardClient}. Trello "boards"
 * are containers and "lists" are the states/columns. Auth is by `key` + `token`
 * query parameters; the token is the per-user secret.
 */
export class TrelloBoardClient implements RemoteBoardClient {
  private readonly key: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: { key: string; token: string }, fetchImpl?: FetchLike) {
    this.key = opts.key;
    this.token = opts.token;
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  private auth(extra: Record<string, string> = {}): string {
    const params = new URLSearchParams({ key: this.key, token: this.token, ...extra });
    return params.toString();
  }

  private async request<T>(
    path: string,
    init?: { method?: string; query?: Record<string, string> },
  ): Promise<T> {
    const url = `${TRELLO_BASE}${path}?${this.auth(init?.query)}`;
    const res = await this.fetchImpl(url, { method: init?.method ?? 'GET' });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Trello ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async listContainers(): Promise<RemoteContainer[]> {
    const boards = await this.request<TrelloBoard[]>('/members/me/boards', {
      query: { fields: 'name' },
    });
    return boards.map((b) => ({ id: b.id, name: b.name }));
  }

  async listStates(containerId: string): Promise<RemoteState[]> {
    const lists = await this.request<TrelloList[]>(`/boards/${containerId}/lists`, {
      query: { fields: 'name' },
    });
    return lists.map((l) => ({ id: l.id, name: l.name }));
  }

  async listIssues(containerId: string): Promise<RemoteIssue[]> {
    const [cards, lists] = await Promise.all([
      this.request<TrelloCard[]>(`/boards/${containerId}/cards`, {
        query: { fields: 'name,desc,idList,shortUrl,idShort' },
      }),
      this.listStates(containerId),
    ]);
    const listNames = new Map(lists.map((l) => [l.id, l.name]));
    return cards.map((c) => ({
      id: c.id,
      identifier: c.idShort != null ? `#${c.idShort}` : c.id,
      title: c.name,
      description: c.desc ?? '',
      stateId: c.idList,
      stateName: listNames.get(c.idList) ?? '',
      url: c.shortUrl ?? '',
    }));
  }

  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    await this.request(`/cards/${issueId}`, {
      method: 'PUT',
      query: { idList: stateId },
    });
  }

  async createComment(issueId: string, body: string): Promise<void> {
    await this.request(`/cards/${issueId}/actions/comments`, {
      method: 'POST',
      query: { text: body },
    });
  }
}

/** Provider factory registered under the `trello` key. */
export function createTrelloClient(config: RemoteConnectionConfig): RemoteBoardClient {
  const key = config.config.key ?? '';
  if (!key) throw new Error('Trello connection requires config.key (API key)');
  return new TrelloBoardClient({ key, token: config.apiKey });
}
