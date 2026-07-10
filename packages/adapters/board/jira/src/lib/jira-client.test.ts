import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '@orion/board-core';
import { adfToText, JiraBoardClient, textToAdf } from './jira-client.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe('adfToText / textToAdf', () => {
  it('extracts text from an ADF document', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'line two' }] },
      ],
    };
    expect(adfToText(doc)).toBe('Hello world\nline two');
  });

  it('round-trips plain text through ADF', () => {
    const adf = textToAdf('note');
    expect(adfToText(adf)).toBe('note');
  });
});

describe('JiraBoardClient', () => {
  it('lists projects as containers keyed by project key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ values: [{ id: '1', key: 'ENG', name: 'Engineering' }] }),
    ) as unknown as FetchLike;
    const client = new JiraBoardClient(
      { baseUrl: 'https://x.atlassian.net/', email: 'a@b.co', apiToken: 't' },
      fetchImpl,
    );
    const containers = await client.listContainers();
    expect(containers).toEqual([{ id: 'ENG', name: 'Engineering', key: 'ENG' }]);
  });

  it('maps search results to normalized issues', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        issues: [
          {
            id: '1001',
            key: 'ENG-1',
            fields: {
              summary: 'Fix bug',
              description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'details' }] }] },
              status: { id: '5', name: 'In Progress' },
            },
          },
        ],
      }),
    ) as unknown as FetchLike;
    const client = new JiraBoardClient(
      { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
      fetchImpl,
    );
    const issues = await client.listIssues('ENG');
    expect(issues[0]).toEqual({
      id: '1001',
      identifier: 'ENG-1',
      title: 'Fix bug',
      description: 'details',
      stateId: '5',
      stateName: 'In Progress',
      url: 'https://x.atlassian.net/browse/ENG-1',
    });
  });

  it('resolves a transition matching the target status', async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const fetchImpl = vi.fn().mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith('/transitions') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse({ transitions: [{ id: '31', to: { id: '5' } }] });
      }
      return jsonResponse({});
    }) as unknown as FetchLike;
    const client = new JiraBoardClient(
      { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
      fetchImpl,
    );
    await client.updateIssueState('1001', '5');
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toContain('"id":"31"');
  });

  it('throws a helpful error on non-ok responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse('Unauthorized', false, 401),
    ) as unknown as FetchLike;
    const client = new JiraBoardClient(
      { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
      fetchImpl,
    );
    await expect(client.listContainers()).rejects.toThrow(/Jira 401/);
  });
});
