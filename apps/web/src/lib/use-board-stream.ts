import { useEffect, useRef } from 'react';
import { boardStreamUrl } from './api';

export function useBoardStream(projectId: string | null, onEvent: (event: { type: string; ticketId: string; column: string }) => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!projectId) return;
    const source = new EventSource(boardStreamUrl(projectId));

    const handler = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { type: string; ticketId: string; column: string };
        if (payload.type === 'sync.completed' || payload.type === 'sync.failed') {
          onEventRef.current(payload);
          return;
        }
        onEventRef.current(payload);
      } catch {
        // ignore malformed frames
      }
    };

    source.addEventListener('ticket.updated', handler as EventListener);
    source.addEventListener('ticket.created', handler as EventListener);
    source.addEventListener('sync.completed', handler as EventListener);
    source.addEventListener('sync.failed', handler as EventListener);

    return () => source.close();
  }, [projectId]);
}
