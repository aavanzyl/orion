import { useCallback, useEffect, useState } from 'react';
import type { Trigger } from '@orion/models';
import { api } from '@/lib/api';

export function useTriggers(projectId: string | null) {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!projectId) {
      setTriggers([]);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .listTriggers(projectId)
      .then(setTriggers)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(refetch, [refetch]);

  return { triggers, loading, error, refetch };
}
