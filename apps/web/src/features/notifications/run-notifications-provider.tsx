import { useEffect, useRef } from 'react';
import { api, runStreamUrl, scheduleStreamUrl, boardStreamUrl, type RunListItem } from '@/lib/api';
import { usePreferences } from '@/lib/use-preferences';
import { useNotifications } from '@/lib/use-notifications';

const ACTIVE_STATUSES = 'running,waiting';
const POLL_INTERVAL_MS = 10_000;

interface RunEventPayload {
  id: string;
  runId: string;
  type: string;
  nodeId?: string;
  payload?: {
    nodeKey?: string;
    nodeType?: string;
    error?: string;
    message?: string;
    from?: string;
    to?: string;
  };
  createdAt: string;
}

interface ScheduleEventPayload {
  type: string;
  scheduleId: string;
  projectId: string;
  name: string;
  error?: string;
  createdAt: string;
}

interface BoardSyncEventPayload {
  type: 'sync.completed' | 'sync.failed';
  projectId: string;
  imported: number;
  updated: number;
  epicsLinked: number;
  error?: string;
  durationMs: number;
  at: string;
}

export function RunNotificationsProvider() {
  const { preferences } = usePreferences();
  const { notify } = useNotifications();
  const events = preferences.notifications.events;
  const workflowEnabled = events.workflowTriggered.toasts || events.workflowTriggered.desktop;
  const agentRunningEnabled = events.agentRunning.toasts || events.agentRunning.desktop;
  const agentFailedEnabled = events.agentFailed.toasts || events.agentFailed.desktop;
  const transitionIssueEnabled = events.transitionIssue.toasts || events.transitionIssue.desktop;
  const nodeTransitionEnabled = events.nodeTransition.toasts || events.nodeTransition.desktop;
  const scheduleFiredEnabled = events.scheduleFired.toasts || events.scheduleFired.desktop;
  const scheduleCompletedEnabled = events.scheduleCompleted.toasts || events.scheduleCompleted.desktop;
  const scheduleFailedEnabled = events.scheduleFailed.toasts || events.scheduleFailed.desktop;
  const scheduleEventsEnabled = scheduleFiredEnabled || scheduleCompletedEnabled || scheduleFailedEnabled;
  const syncCompletedEnabled =
    (events as Record<string, { toasts: boolean; desktop: boolean }>)['sync.completed']?.toasts ||
    (events as Record<string, { toasts: boolean; desktop: boolean }>)['sync.completed']?.desktop ||
    false;
  const syncFailedEnabled =
    (events as Record<string, { toasts: boolean; desktop: boolean }>)['sync.failed']?.toasts ||
    (events as Record<string, { toasts: boolean; desktop: boolean }>)['sync.failed']?.desktop ||
    false;
  const syncEventsEnabled = syncCompletedEnabled || syncFailedEnabled;
  const sseAvailable = typeof EventSource !== 'undefined';
  const activeSubscriptions = useRef<Map<string, EventSource>>(new Map());
  const notifiedRuns = useRef<Set<string>>(new Set());
  const nodeTypes = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!workflowEnabled) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const runs = await api.listRuns({ status: 'created', limit: 10 });
        for (const run of runs) {
          if (cancelled) return;
          if (notifiedRuns.current.has(run.id)) continue;
          notifiedRuns.current.add(run.id);
          notify('workflowTriggered', {
            title: `Workflow triggered: ${run.workflowName}`,
            description: run.ticketTitle ? `Ticket: ${run.ticketTitle}` : undefined,
          });
        }
      } catch {
        // ignore — polling is best-effort
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [workflowEnabled, notify]);

  useEffect(() => {
    if (!agentRunningEnabled && !agentFailedEnabled && !nodeTransitionEnabled && !transitionIssueEnabled) {
      for (const [, source] of activeSubscriptions.current) {
        source.close();
      }
      activeSubscriptions.current.clear();
      return;
    }

    if (!sseAvailable) return;

    let cancelled = false;

    const handleEvent = (run: RunListItem, event: RunEventPayload) => {
      if (event.type === 'node.started') {
        const nodeKey = event.payload?.nodeKey ?? event.nodeId ?? '';
        const nodeType = event.payload?.nodeType ?? '';
        if (nodeKey && nodeType) {
          nodeTypes.current.set(nodeKey, nodeType);
        }

        if (agentRunningEnabled && nodeType === 'agent') {
          notify('agentRunning', {
            title: `Agent running: ${nodeKey}`,
            description: `Run: ${run.workflowName}${run.ticketTitle ? ` — ${run.ticketTitle}` : ''}`,
            url: `${window.location.origin}/dashboard?run=${run.id}`,
          });
        }
      }

      if (event.type === 'node.failed' && agentFailedEnabled) {
        const nodeKey = event.payload?.nodeKey ?? event.nodeId ?? '';
        const knownType = nodeTypes.current.get(nodeKey);
        if (knownType === 'agent') {
          const error = event.payload?.error ?? event.payload?.message ?? '';
          notify('agentFailed', {
            title: `Agent failed: ${nodeKey}`,
            description: error || `Run: ${run.workflowName}`,
            url: `${window.location.origin}/dashboard?run=${run.id}`,
          });
        }
      }

      if (event.type === 'transition' && nodeTransitionEnabled) {
        const nodeKey = event.payload?.nodeKey ?? event.nodeId ?? '';
        const from = event.payload?.from ?? 'unknown';
        const to = event.payload?.to ?? 'unknown';
        notify('nodeTransition', {
          title: `Node transition: ${nodeKey}`,
          description: `${from} → ${to} | Run: ${run.workflowName}`,
          url: `${window.location.origin}/dashboard?run=${run.id}`,
        });
      }

      if (event.type === 'run.transition' && transitionIssueEnabled) {
        const from = event.payload?.from ?? 'unknown';
        const to = event.payload?.to ?? 'unknown';
        const error = event.payload?.error;
        if (to === 'failed' || error) {
          notify('transitionIssue', {
            title: `Run transition issue: ${run.workflowName}`,
            description: `${from} → ${to}${error ? ` — ${error}` : ''}`,
            url: `${window.location.origin}/dashboard?run=${run.id}`,
          });
        }
      }
    };

    const subscribeToRun = async (run: RunListItem) => {
      if (activeSubscriptions.current.has(run.id)) return;
      if (run.status !== 'running' && run.status !== 'waiting') return;

      try {
        const result = await api.getRun(run.id).catch(() => null);
        if (result?.nodes) {
          for (const node of result.nodes) {
            nodeTypes.current.set(node.nodeKey, node.type);
          }
        }
      } catch {
        // best-effort
      }

      const source = new EventSource(runStreamUrl(run.id));
      activeSubscriptions.current.set(run.id, source);

      source.onerror = () => {
        source.close();
        activeSubscriptions.current.delete(run.id);
      };

      source.onmessage = (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as RunEventPayload;
          handleEvent(run, event);
        } catch {
          // ignore malformed frames
        }
      };
    };

    const poll = async () => {
      try {
        const runs = await api.listRuns({ status: ACTIVE_STATUSES, limit: 50 });
        if (cancelled) return;

        const activeRunIds = new Set(runs.map((r) => r.id));

        for (const run of runs) {
          await subscribeToRun(run);
        }

        for (const [runId, source] of activeSubscriptions.current) {
          if (!activeRunIds.has(runId)) {
            source.close();
            activeSubscriptions.current.delete(runId);
          }
        }
      } catch {
        // ignore
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      for (const [, source] of activeSubscriptions.current) {
        source.close();
      }
      activeSubscriptions.current.clear();
    };
  }, [agentRunningEnabled, agentFailedEnabled, nodeTransitionEnabled, transitionIssueEnabled, notify]);

  useEffect(() => {
    if (!scheduleEventsEnabled) return;
    if (!sseAvailable) return;

    let cancelled = false;
    let source: EventSource | null = null;

    const connect = () => {
      if (cancelled) return;
      source = new EventSource(scheduleStreamUrl());

      source.onmessage = (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as ScheduleEventPayload;

          if (event.type === 'schedule.fired' && scheduleFiredEnabled) {
            notify('scheduleFired', {
              title: `Schedule fired: ${event.name}`,
              description: `Schedule ${event.scheduleId.slice(0, 8)} fired`,
            });
          }

          if (event.type === 'schedule.completed' && scheduleCompletedEnabled) {
            notify('scheduleCompleted', {
              title: `Schedule completed: ${event.name}`,
              description: `Schedule ${event.scheduleId.slice(0, 8)} completed successfully`,
            });
          }

          if (event.type === 'schedule.failed' && scheduleFailedEnabled) {
            const error = event.error ?? 'Unknown error';
            notify('scheduleFailed', {
              title: `Schedule failed: ${event.name}`,
              description: error,
            });
          }
        } catch {
          // ignore malformed frames
        }
      };

      source.onerror = () => {
        source?.close();
        if (!cancelled) {
          setTimeout(connect, 30_000);
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [scheduleEventsEnabled, scheduleFiredEnabled, scheduleCompletedEnabled, scheduleFailedEnabled, notify]);

  useEffect(() => {
    if (!syncEventsEnabled) return;
    if (!sseAvailable) return;

    let cancelled = false;
    const boardSources = new Map<string, EventSource>();

    const subscribeToBoard = (projectId: string) => {
      if (boardSources.has(projectId)) return;
      const source = new EventSource(boardStreamUrl(projectId));
      boardSources.set(projectId, source);

      source.onmessage = (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as BoardSyncEventPayload;

          if (event.type === 'sync.completed' && syncCompletedEnabled) {
            notify('sync.completed', {
              title: `Board sync: ${event.imported} imported, ${event.updated} updated`,
              description: `${event.epicsLinked} epics linked`,
            });
          }

          if (event.type === 'sync.failed' && syncFailedEnabled) {
            notify('sync.failed', {
              title: `Board sync failed: ${event.error ?? 'Unknown error'}`,
              description: `${event.imported} imported, ${event.updated} updated`,
            });
          }
        } catch {
          // ignore malformed frames
        }
      };

      source.onerror = () => {
        source.close();
        boardSources.delete(projectId);
      };
    };

    const discoverAndSubscribe = async () => {
      try {
        const projects = await api.listProjects();
        for (const project of projects) {
          if (cancelled) return;
          try {
            const conn = await api.getBoardConnection(project.id);
            if (conn.connected) {
              subscribeToBoard(project.id);
            }
          } catch {
            // skip projects without board connections
          }
        }
      } catch {
        // ignore
      }
    };

    discoverAndSubscribe();
    const interval = setInterval(discoverAndSubscribe, 60_000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      for (const [, source] of boardSources) {
        source.close();
      }
      boardSources.clear();
    };
  }, [syncEventsEnabled, syncCompletedEnabled, syncFailedEnabled, notify]);

  return null;
}
