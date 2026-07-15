import { useCallback, useEffect, useMemo, useState } from 'react';
import { BugIcon, SearchIcon, XIcon } from 'lucide-react';
import type { Ticket, WorkflowRun } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RunLogViewer } from '@/components/run-log-viewer';
import { api } from '@/lib/api';

export function DebugPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);

  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string>('');
  const [search, setSearch] = useState('');
  const [runs, setRuns] = useState<WorkflowRun[]>([]);

  const [ticketDetail, setTicketDetail] = useState<Ticket | null>(null);

  useEffect(() => {
    if (!selectedTicketId) {
      setTicketDetail(null);
      setRuns([]);
      return;
    }
    api.listAllTickets().then((all) => {
      const t = all.find((tk) => tk.id === selectedTicketId);
      setTicketDetail(t ?? null);
    }).catch(() => setTicketDetail(null));
    api.listTicketRuns(selectedTicketId).then(setRuns).catch(() => setRuns([]));
  }, [selectedTicketId]);

  const loadAllTickets = useCallback(async () => {
    setTicketsLoading(true);
    try {
      const all = await api.listAllTickets();
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        setTickets(all.filter((t) => t.title.toLowerCase().includes(q) || t.id.slice(0, 8).includes(q)));
      } else {
        setTickets(all);
      }
    } catch {
      setTickets([]);
    } finally {
      setTicketsLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadAllTickets();
  }, [loadAllTickets]);

  const selectedTicket = useMemo(() => {
    if (!selectedTicketId) return null;
    return tickets.find((t) => t.id === selectedTicketId);
  }, [tickets, selectedTicketId]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Debug Logs</h1>
          <p className="text-sm text-muted-foreground">
            Inspect workflow logs, transitions, and events to debug runs.
          </p>
        </div>
      </header>

      <div className="flex items-center gap-3 border-b px-6 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets..."
              className="w-48"
              onKeyDown={(e) => {
                if (e.key === 'Enter') loadAllTickets();
              }}
            />
            <Button size="sm" variant="outline" onClick={loadAllTickets}>
              <SearchIcon data-icon="inline-start" />
            </Button>
          </div>

          <Select
            value={selectedTicketId ?? ''}
            onValueChange={(v) => {
              setSelectedTicketId(v || null);
              setSelectedRunId(null);
            }}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select a ticket..." />
            </SelectTrigger>
            <SelectContent>
              {tickets.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="truncate">{t.title}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{t.id.slice(0, 8)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={selectedRunId ?? ''}
            onValueChange={(v) => {
              setSelectedRunId(v || null);
              setSelectedNodeKey('');
            }}
            disabled={!selectedTicketId || runs.length === 0}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All runs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All runs</SelectItem>
              {runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.workflowName} ({r.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={selectedNodeKey}
            onChange={(e) => setSelectedNodeKey(e.target.value)}
            placeholder="Filter by node key..."
            className="w-40"
          />

          {(selectedTicketId || selectedNodeKey) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedTicketId(null);
                setSelectedRunId(null);
                setSelectedNodeKey('');
              }}
            >
              <XIcon data-icon="inline-start" />
              Clear
            </Button>
          )}
        </div>
      </div>

      <main className="flex min-h-0 flex-1">
        {!selectedTicketId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <BugIcon className="size-8 text-muted-foreground" />
            <p className="text-muted-foreground">
              Search for and select a ticket to inspect its workflow logs.
            </p>
            {ticketsLoading ? (
              <div className="flex flex-col gap-2 w-64">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : tickets.length > 0 ? (
              <div className="flex flex-col gap-1 w-64">
                <p className="text-xs font-medium text-muted-foreground">Recent tickets</p>
                <ScrollArea className="max-h-48 rounded-md border">
                  {tickets.slice(0, 10).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTicketId(t.id)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted/30 border-b last:border-0"
                    >
                      <div className="truncate font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground">{t.id.slice(0, 8)}</div>
                    </button>
                  ))}
                </ScrollArea>
              </div>
            ) : search ? (
              <p className="text-sm text-muted-foreground">No tickets found.</p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-1 flex-col min-h-0">
            {selectedTicket && (
              <div className="flex items-center gap-2 border-b px-6 py-2 text-sm">
                <Badge variant="secondary" className="font-mono text-xs">
                  {selectedTicket.displayKey ?? selectedTicket.id.slice(0, 8)}
                </Badge>
                <span className="font-medium truncate">{selectedTicket.title}</span>
                {ticketDetail?.workflowName && (
                  <Badge variant="outline" className="text-xs">
                    {ticketDetail.workflowName}
                  </Badge>
                )}
              </div>
            )}
            <div className="flex-1 overflow-auto p-6">
              <RunLogViewer
                key={`${selectedTicketId}-${selectedRunId}`}
                ticketId={selectedRunId ? undefined : selectedTicketId}
                runId={selectedRunId ?? undefined}
                nodeKeyFilter={selectedNodeKey || undefined}
                maxHeight="100%"
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
