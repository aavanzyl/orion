import { useCallback, useEffect, useState } from 'react';
import type { Conversation } from '@orion/models';
import { api } from '@/lib/api';

export function useConversations(projectId: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(() => {
    if (!projectId) {
      setConversations([]);
      return;
    }
    setLoading(true);
    api
      .listConversations(projectId)
      .then(setConversations)
      .catch(() => setConversations([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(refetch, [refetch]);

  return { conversations, loading, refetch, setConversations };
}

/**
 * Load conversations across every project so the chat sidebar can group them
 * under their project headings. Fetches each project's list in parallel and
 * flattens the result; failures for one project degrade to an empty list.
 */
export function useAllConversations(projectIds: string[]) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const key = projectIds.join(',');

  const refetch = useCallback(() => {
    if (projectIds.length === 0) {
      setConversations([]);
      return;
    }
    setLoading(true);
    Promise.all(
      projectIds.map((id) => api.listConversations(id).catch(() => [] as Conversation[])),
    )
      .then((lists) => setConversations(lists.flat()))
      .finally(() => setLoading(false));
  }, [key]);

  useEffect(refetch, [refetch]);

  return { conversations, loading, refetch, setConversations };
}
