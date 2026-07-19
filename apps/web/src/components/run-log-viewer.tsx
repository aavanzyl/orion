import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2Icon,
  CircleIcon,
  GitBranchIcon,
  InfoIcon,
  LogsIcon,
  MessageSquareIcon,
  PlayIcon,
  RefreshCwIcon,
  ShuffleIcon,
  SkipForwardIcon,
  XCircleIcon,
} from 'lucide-react';
import type { RunEvent, RunEventType } from '@orion/models';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api } from '@/lib/api';

const EVENT_GROUPS: { label: string; types: RunEventType[] }[] = [
  { label: 'All events', types: [] },
  { label: 'Logs & transitions', types: ['log'] },
  { label: 'Node lifecycle', types: ['node.started', 'node.completed', 'node.failed', 'node.skipped', 'node.status', 'node.retry', 'node.iteration', 'node.matrix'] },
  { label: 'Transitions', types: ['run.transition', 'transition', 'ticket.moved', 'ticket.updated', 'ticket.created', 'ticket.deleted'] },
  { label: 'Agent messages', types: ['agent.message', 'agent.item', 'agent.usage'] },
  { label: 'Comments', types: ['ticket.comment'] },
  { label: 'Run lifecycle', types: ['run.created', 'run.status', 'run.diff'] },
  { label: 'Ticket updates', types: ['ticket.moved', 'ticket.updated', 'ticket.created', 'ticket.deleted'] },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface RunLogViewerProps {
  runId?: string;
  ticketId?: string;
  nodeKeyFilter?: string;
  compact?: boolean;
  maxHeight?: string;
}

export function RunLogViewer({
  runId,
  ticketId,
  nodeKeyFilter,
  compact = false,
  maxHeight = '400px',
}: RunLogViewerProps) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventGroup, setEventGroup] = useState<string>('All events');

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      let result: RunEvent[];
      const group = EVENT_GROUPS.find((g) => g.label === eventGroup);
      const typeFilter = group?.types.length === 1 ? group.types[0] : undefined;

      if (runId) {
        result = await api.listRunEvents(runId, typeFilter ? { type: typeFilter } : undefined);
      } else if (ticketId) {
        result = await api.listTicketLogs(ticketId, {
          type: typeFilter,
          nodeKey: nodeKeyFilter,
          limit: 200,
        });
      } else {
        result = [];
      }
      setEvents(result);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [runId, ticketId, eventGroup, nodeKeyFilter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const filtered = useMemo(() => {
    const group = EVENT_GROUPS.find((g) => g.label === eventGroup);
    if (!group) return events;
    return group.types.length === 0
      ? events
      : events.filter((e) => group.types.includes(e.type));
  }, [events, eventGroup]);

  const eventIcon = (type: RunEventType) => {
    switch (type) {
      case 'log':
        return <InfoIcon className="size-3.5" />;
      case 'node.started':
        return <PlayIcon className="size-3.5 text-blue-500" />;
      case 'node.completed':
        return <CheckCircle2Icon className="size-3.5 text-green-500" />;
      case 'node.failed':
        return <XCircleIcon className="size-3.5 text-destructive" />;
      case 'node.skipped':
        return <SkipForwardIcon className="size-3.5 text-muted-foreground" />;
      case 'node.retry':
        return <RefreshCwIcon className="size-3.5 text-amber-500" />;
      case 'node.iteration':
      case 'node.matrix':
        return <GitBranchIcon className="size-3.5 text-purple-500" />;
      case 'node.status':
        return <CircleIcon className="size-3.5" />;
      case 'run.created':
      case 'run.status':
      case 'run.diff':
        return <LogsIcon className="size-3.5 text-blue-400" />;
      case 'run.transition':
      case 'transition':
        return <ShuffleIcon className="size-3.5 text-orange-500" />;
      case 'ticket.moved':
      case 'ticket.updated':
      case 'ticket.created':
      case 'ticket.deleted':
        return <MessageSquareIcon className="size-3.5 text-teal-500" />;
      case 'agent.message':
      case 'agent.item':
        return <MessageSquareIcon className="size-3.5 text-indigo-500" />;
      case 'agent.usage':
        return <InfoIcon className="size-3.5 text-indigo-400" />;
      default:
        return <CircleIcon className="size-3.5" />;
    }
  };

  const eventBg = (type: RunEventType): string => {
    if (type === 'log') return '';
    if (type.startsWith('node.failed')) return 'bg-destructive/5';
    if (type.startsWith('node.completed')) return 'bg-green-500/5';
    if (type.startsWith('node.started')) return 'bg-blue-500/5';
    if (type === 'run.transition' || type === 'transition') return 'bg-orange-500/5';
    return '';
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {filtered.length} event{filtered.length !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-2">
          <Select value={eventGroup} onValueChange={setEventGroup}>
            <SelectTrigger className="h-7 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENT_GROUPS.map((g) => (
                <SelectItem key={g.label} value={g.label} className="text-xs">
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={fetchEvents}
            disabled={loading}
          >
            <RefreshCwIcon className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No events found.</p>
      ) : (
        <ScrollArea style={{ maxHeight }}>
          <div className="flex flex-col">
            {filtered.map((event, i) => {
              const payload = event.payload as Record<string, unknown> | null;
              const message = typeof payload?.message === 'string' ? payload.message
                : event.type === 'agent.message' && typeof payload?.text === 'string' ? payload.text
                : event.type === 'ticket.comment' && typeof payload?.body === 'string' ? payload.body
                : event.type === 'agent.usage' ? undefined
                : typeof payload?.error === 'string' ? payload.error
                : undefined;
              const nodeKey = typeof payload?.nodeKey === 'string' ? payload.nodeKey : undefined;
              const isLog = event.type === 'log';
              const isComment = event.type === 'ticket.comment';
              const isAgentMessage = event.type === 'agent.message';

              return (
                <div
                  key={event.id ?? i}
                  className={`flex items-start gap-2 border-b px-2 py-1.5 last:border-0 ${eventBg(event.type)} ${isComment ? 'bg-indigo-500/5 border-l-2 border-l-indigo-500' : ''}`}
                >
                  <span className="mt-0.5 shrink-0">{eventIcon(event.type)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {nodeKey && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px] font-mono">
                          {nodeKey}
                        </Badge>
                      )}
                      {!compact && (
                        <Badge variant="outline" className="h-4 px-1 text-[10px] font-mono">
                          {event.type}
                        </Badge>
                      )}
                      {isComment ? (
                        <div className="w-full">
                          <span className="text-xs font-medium text-indigo-500">Comment</span>
                          <pre className="mt-0.5 whitespace-pre-wrap text-xs text-foreground/80">{message}</pre>
                        </div>
                      ) : isAgentMessage && message ? (
                        <span className="text-xs text-foreground/80">{message}</span>
                      ) : isLog ? (
                        <span className="text-xs text-foreground/80">{message ?? JSON.stringify(payload)}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {message ?? (compact ? formatTime(event.createdAt) : event.type)}
                        </span>
                      )}
                    </div>
                    {!compact && !isLog && payload && Object.keys(payload).length > 0 && (
                      <pre className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-muted-foreground/60">
                        {JSON.stringify(payload, null, 2).slice(0, 120)}
                      </pre>
                    )}
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground/50">
                    {formatTime(event.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
