import { useEffect, useState } from 'react';
import type { RunEvent } from '@orion/models';
import { runStreamUrl } from './api';

/**
 * Subscribe to a run's Server-Sent Events stream. Returns the accumulated
 * events (past + live) in arrival order.
 */
export function useRunStream(runId: string | null): RunEvent[] {
  const [events, setEvents] = useState<RunEvent[]>([]);

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      return;
    }
    setEvents([]);
    const source = new EventSource(runStreamUrl(runId));

    const handler = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as RunEvent;
        setEvents((prev) => (prev.some((p) => p.id === event.id) ? prev : [...prev, event]));
      } catch {
        // ignore malformed frames (e.g. keep-alive comments)
      }
    };

    const types = [
      'run.created',
      'run.status',
      'run.diff',
      'node.status',
      'node.started',
      'node.completed',
      'node.failed',
      'node.skipped',
      'node.retry',
      'node.iteration',
      'node.matrix',
      'agent.message',
      'agent.item',
      'agent.usage',
      'agent.structured',
      'ticket.moved',
      'ticket.updated',
      'log',
    ];
    for (const type of types) {
      source.addEventListener(type, handler as EventListener);
    }
    source.onmessage = handler;

    return () => source.close();
  }, [runId]);

  return events;
}
