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
