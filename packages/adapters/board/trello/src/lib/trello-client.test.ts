import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '@orion/board-core';
import { TrelloBoardClient } from './trello-client.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe('TrelloBoardClient', () => {
  it('lists boards as containers with auth params', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      urls.push(url);
      return jsonResponse([{ id: 'b1', name: 'Roadmap' }]);
    }) as unknown as FetchLike;
    const client = new TrelloBoardClient({ key: 'K', token: 'T' }, fetchImpl);
    const containers = await client.listContainers();
    expect(containers).toEqual([{ id: 'b1', name: 'Roadmap' }]);
    expect(urls[0]).toContain('key=K');
    expect(urls[0]).toContain('token=T');
  });

  it('joins cards to their list names', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/cards')) {
        return jsonResponse([
          { id: 'c1', idShort: 7, name: 'Card', desc: 'body', idList: 'l1', shortUrl: 'https://trello.com/c/x' },
        ]);
      }
      if (url.includes('/lists')) {
        return jsonResponse([{ id: 'l1', name: 'Doing' }]);
      }
      return jsonResponse([]);
    }) as unknown as FetchLike;
    const client = new TrelloBoardClient({ key: 'K', token: 'T' }, fetchImpl);
    const issues = await client.listIssues('b1');
    expect(issues[0]).toEqual({
      id: 'c1',
      identifier: '#7',
      title: 'Card',
      description: 'body',
      stateId: 'l1',
      stateName: 'Doing',
      url: 'https://trello.com/c/x',
    });
  });

  it('moves a card by updating idList', async () => {
    const calls: { url: string; method?: string }[] = [];
    const fetchImpl = vi.fn().mockImplementation(async (url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method });
      return jsonResponse({});
    }) as unknown as FetchLike;
    const client = new TrelloBoardClient({ key: 'K', token: 'T' }, fetchImpl);
    await client.updateIssueState('c1', 'l2');
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toContain('idList=l2');
  });

  it('throws on non-ok responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse('nope', false, 401),
    ) as unknown as FetchLike;
    const client = new TrelloBoardClient({ key: 'K', token: 'T' }, fetchImpl);
    await expect(client.listContainers()).rejects.toThrow(/Trello 401/);
  });
});
