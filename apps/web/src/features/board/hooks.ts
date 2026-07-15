import { useCallback, useEffect, useState } from 'react';
import type { Board, Epic, Label, TicketDetail } from '@orion/models';
import { api, type ProjectConfigResponse } from '@/lib/api';

export { useProjects } from '@/features/projects/hooks';

export function useProjectConfig(projectId: string | null) {
  const [config, setConfig] = useState<ProjectConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setError(null);
    api
      .getProjectConfig(projectId)
      .then(setConfig)
      .catch((e: Error) => setError(e.message));
  }, [projectId]);

  return { config, error };
}

export function useBoard(projectId: string | null) {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .getBoard(projectId)
      .then(setBoard)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(refetch, [refetch]);

  return { board, loading, error, refetch, setBoard };
}

export function useLabels(projectId: string | null) {
  const [labels, setLabels] = useState<Label[]>([]);

  const refetch = useCallback(() => {
    if (!projectId) {
      setLabels([]);
      return;
    }
    api
      .listLabels(projectId)
      .then(setLabels)
      .catch(() => undefined);
  }, [projectId]);

  useEffect(refetch, [refetch]);

  const createLabel = useCallback(
    async (name: string, color: string): Promise<void> => {
      if (!projectId) return;
      const label = await api.createLabel(projectId, { name, color });
      setLabels((prev) => [...prev, label].sort((a, b) => a.name.localeCompare(b.name)));
    },
    [projectId],
  );

  return { labels, refetch, createLabel };
}

export function useTicketDetail(ticketId: string | null) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(() => {
    if (!ticketId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    api
      .getTicketDetail(ticketId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [ticketId]);

  useEffect(refetch, [refetch]);

  return { detail, loading, refetch };
}

export function useEpics(projectId: string | null) {
  const [epics, setEpics] = useState<Epic[]>([]);

  const refetch = useCallback(() => {
    if (!projectId) {
      setEpics([]);
      return;
    }
    api
      .listEpics(projectId)
      .then(setEpics)
      .catch(() => undefined);
  }, [projectId]);

  useEffect(refetch, [refetch]);

  return { epics, refetch };
}
