import { useCallback, useEffect, useState } from 'react';
import type { Schedule } from '@orion/models';
import { api } from '@/lib/api';

export function useSchedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .listAllSchedules()
      .then(setSchedules)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refetch, [refetch]);

  return { schedules, loading, error, refetch };
}
