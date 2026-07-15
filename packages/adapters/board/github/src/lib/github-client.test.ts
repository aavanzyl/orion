import { describe, expect, it } from 'vitest';
import { GitHubBoardClient } from './github-client.js';

function fakeFetch(
  responses: Array<{ status: number; body: unknown }>,
): typeof globalThis.fetch {
  let call = 0;
  return ((_url: string, _init?: RequestInit) => {
    const r = responses[call++] ?? { status: 500, body: {} };
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: r.status === 200 ? 'OK' : 'Error',
      text: () => Promise.resolve(JSON.stringify(r.body)),
      json: () => Promise.resolve(r.body),
    });
  }) as unknown as typeof globalThis.fetch;
}

describe('GitHubBoardClient', () => {
  const repo = 'test-owner/test-repo';

  it('lists repositories as containers', async () => {
    const fetch = fakeFetch([
      {
        status: 200,
        body: [
          { id: 1, full_name: 'test-owner/test-repo', name: 'test-repo' },
          { id: 2, full_name: 'test-owner/other-repo', name: 'other-repo' },
        ],
      },
    ]);
    const client = new GitHubBoardClient('token', repo, fetch);
    const containers = await client.listContainers();
    expect(containers).toHaveLength(2);
    expect(containers[0].id).toBe('test-owner/test-repo');
    expect(containers[0].name).toBe('test-repo');
  });

  it('lists labels as states', async () => {
    const fetch = fakeFetch([
      {
        status: 200,
        body: [
          { id: 1, name: 'bug', color: 'd73a4a' },
          { id: 2, name: 'enhancement', color: 'a2eeef' },
        ],
      },
    ]);
    const client = new GitHubBoardClient('token', repo, fetch);
    const states = await client.listStates(repo);
    expect(states).toHaveLength(2);
    expect(states[0].id).toBe('bug');
    expect(states[0].name).toBe('bug');
    expect(states[0].type).toBe('label');
  });

  it('lists issues excluding pull requests', async () => {
    const fetch = fakeFetch([
      {
        status: 200,
        body: [
          {
            id: 100,
            number: 1,
            title: 'Fix bug',
            body: 'Description',
            state: 'open',
            labels: [{ id: 3, name: 'bug', color: 'd73a4a' }],
            html_url: 'https://github.com/test-owner/test-repo/issues/1',
          },
          {
            id: 101,
            number: 2,
            title: 'A PR',
            body: null,
            state: 'open',
            labels: [],
            html_url: 'https://github.com/test-owner/test-repo/pull/2',
            pull_request: {},
          },
          {
            id: 102,
            number: 3,
            title: 'No labels',
            body: null,
            state: 'open',
            labels: [],
            html_url: 'https://github.com/test-owner/test-repo/issues/3',
          },
        ],
      },
    ]);
    const client = new GitHubBoardClient('token', repo, fetch);
    const issues = await client.listIssues(repo);
    expect(issues).toHaveLength(2);
    expect(issues[0].id).toBe('1');
    expect(issues[0].identifier).toBe('#1');
    expect(issues[0].title).toBe('Fix bug');
    expect(issues[0].stateId).toBe('bug');
    expect(issues[0].stateName).toBe('bug');
    expect(issues[0].url).toBe('https://github.com/test-owner/test-repo/issues/1');
    expect(issues[1].stateId).toBe('open');
    expect(issues[1].stateName).toBe('open');
  });

  it('updates issue state by setting labels', async () => {
    const fetch = fakeFetch([
      { status: 200, body: {} },
    ]);
    const client = new GitHubBoardClient('token', repo, fetch);
    await client.updateIssueState('42', 'done');
  });

  it('creates a comment', async () => {
    const fetch = fakeFetch([
      { status: 201, body: { id: 1, body: 'PR opened' } },
    ]);
    const client = new GitHubBoardClient('token', repo, fetch);
    await client.createComment('42', 'PR opened');
  });

  it('throws on error responses', async () => {
    const fetch = fakeFetch([
      { status: 401, body: { message: 'Bad credentials' } },
    ]);
    const client = new GitHubBoardClient('token', repo, fetch);
    await expect(client.listContainers()).rejects.toThrow('GitHub 401');
  });
});
