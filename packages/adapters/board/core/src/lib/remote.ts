/**
 * Provider-agnostic contract for syncing an external task board (Linear, Jira,
 * Trello, ...) into Orion's native board. Each provider ships a thin client that
 * normalizes its API onto these DTOs so the orchestrator's sync engine stays
 * provider-independent.
 */

/** A syncable remote issue/card/ticket normalized across providers. */
export interface RemoteIssue {
  /** Stable id in the remote system (used as the ticket `externalId`). */
  id: string;
  /** Human key, e.g. `ENG-42`, `PROJ-7`, or a Trello short link. */
  identifier: string;
  title: string;
  description: string;
  /** Id of the remote state/column/list this issue currently sits in. */
  stateId: string;
  /** Display name of that state (used for fuzzy mapping to swimlanes). */
  stateName: string;
  /** Deep link back to the remote issue. */
  url: string;
  /** Priority 0-4, Linear scale (0 = none, 1 = urgent, 4 = low). */
  priority?: number;
  /** Due date in YYYY-MM-DD format. */
  dueDate?: string;
  /** When the issue was started, ISO 8601. */
  startedAt?: string;
  /** Labels attached to the remote issue. */
  labels?: Array<{ name: string; color?: string }>;
  /** The parent container/project grouping (Linear project, Jira epic, etc.). */
  epic?: { id: string; name: string; color?: string };
}

/** A remote workflow state / board column / list. */
export interface RemoteState {
  id: string;
  name: string;
  /** Optional provider category, e.g. `unstarted | started | completed`. */
  type?: string;
}

/**
 * A remote "container" that owns issues: a Linear team, a Jira project, or a
 * Trello board. Its {@link RemoteContainer.id} is stored on the connection as
 * the `containerId` and passed back into the other calls.
 */
export interface RemoteContainer {
  id: string;
  name: string;
  /** Optional short key, e.g. Linear `ENG` or Jira project key. */
  key?: string;
}

/** Everything a provider needs to talk to the remote board for one project. */
export interface RemoteConnectionConfig {
  provider: string;
  /** The primary secret: Linear API key, Jira API token, or Trello token. */
  apiKey: string;
  /** Team / project / board id this connection syncs against. */
  containerId: string;
  /** Non-secret provider extras (Jira `baseUrl`/`email`, Trello `key`, ...). */
  config: Record<string, string>;
}

/** Normalized remote board client implemented per provider. */
export interface RemoteBoardClient {
  /** Teams (Linear) / projects (Jira) / boards (Trello) the token can see. */
  listContainers(): Promise<RemoteContainer[]>;
  /** States/columns/lists within a container. */
  listStates(containerId: string): Promise<RemoteState[]>;
  /** Issues/cards within a container. */
  listIssues(containerId: string): Promise<RemoteIssue[]>;
  /** Move a remote issue into a target state. Best-effort. */
  updateIssueState(issueId: string, stateId: string): Promise<void>;
  /** Post a comment onto a remote issue. */
  createComment(issueId: string, body: string): Promise<void>;
}

/** Builds a {@link RemoteBoardClient} from a connection's config. */
export type RemoteBoardClientFactory = (config: RemoteConnectionConfig) => RemoteBoardClient;

/** Minimal `fetch` surface, so REST clients can be tested without the network. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;
