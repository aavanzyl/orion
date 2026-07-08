import { useCallback, useEffect, useState } from 'react';
import type { Provider } from '@orion/models';
import { api } from '@/lib/api';

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    api
      .listProviders()
      .then(setProviders)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refetch, [refetch]);

  return { providers, loading, error, refetch };
}
