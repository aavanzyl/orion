import { useCallback, useEffect, useState } from 'react';
import type { Project } from '@orion/models';
import { api } from '@/lib/api';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    api
      .listProjects()
      .then(setProjects)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refetch, [refetch]);

  return { projects, loading, error, refetch };
}
