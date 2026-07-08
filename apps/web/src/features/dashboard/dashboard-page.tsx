import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActivityIcon, ExternalLinkIcon, SearchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api, type RunListItem } from '@/lib/api';
import { useProjects } from '@/features/projects/hooks';

  const STATUS_VARIANT: Record<string, 'default' | 'destructive' | 'outline' | 'secondary' | 'success' | 'warning' | 'info'> = {
  created: 'outline',
  queued: 'outline',
  scheduled: 'info',
  running: 'info',
  waiting: 'warning',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'outline',
};

const POLL_INTERVAL_MS = 30000;

export function DashboardPage() {
  const { projects } = useProjects();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterProjectId, setFilterProjectId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedRun, setSelectedRun] = useState<RunListItem | null>(null);
  const [runDetail, setRunDetail] = useState<{ nodes: Array<{ nodeKey: string; type: string; status: string }>; run: RunListItem | null } | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const params: { projectId?: string; status?: string; search?: string; limit?: number } = { limit: 50 };
      if (filterProjectId && filterProjectId !== 'all') params.projectId = filterProjectId;
      if (filterStatus && filterStatus !== 'all') params.status = filterStatus;
      if (searchApplied) params.search = searchApplied;
      const result = await api.listRuns(params);
      setRuns(result);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filterProjectId, filterStatus, searchApplied]);

  useEffect(() => {
    setLoading(true);
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    const timer = setInterval(fetchRuns, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchRuns]);

  const handleSearch = () => {
    setSearchApplied(search);
  };

  const openRun = async (run: RunListItem) => {
    setSelectedRun(run);
    try {
      const detail = await api.getRun(run.id);
      setRunDetail({ nodes: detail.nodes, run: detail.run });
    } catch {
      setRunDetail({ nodes: [], run: null });
    }
  };

  const stats = useMemo(() => {
    const total = runs.length;
    const active = runs.filter((r) => !['completed', 'failed', 'cancelled'].includes(r.status)).length;
    const completed = runs.filter((r) => r.status === 'completed').length;
    const resolved = completed + runs.filter((r) => r.status === 'failed').length;
    const successRate = resolved > 0 ? Math.round((completed / resolved) * 10000) / 100 : 0;
    return { total, active, successRate };
  }, [runs]);

  const totalCost = useMemo(() => runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0), [runs]);
  const totalTokens = useMemo(() => runs.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0), [runs]);

  const sortedRuns = useMemo(() => {
    if (!sortField) return runs;
    return [...runs].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'ticket':
          cmp = (a.ticketTitle ?? '').localeCompare(b.ticketTitle ?? '');
          break;
        case 'workflow':
          cmp = (a.workflowName ?? '').localeCompare(b.workflowName ?? '');
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'duration': {
          const da = (a.updatedAt && a.createdAt) ? new Date(a.updatedAt).getTime() - new Date(a.createdAt).getTime() : 0;
          const db = (b.updatedAt && b.createdAt) ? new Date(b.updatedAt).getTime() - new Date(b.createdAt).getTime() : 0;
          cmp = da - db;
          break;
        }
        case 'tokens':
          cmp = (a.totalTokens ?? 0) - (b.totalTokens ?? 0);
          break;
        case 'cost':
          cmp = (a.costUsd ?? 0) - (b.costUsd ?? 0);
          break;
        case 'created':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [runs, sortField, sortDir]);

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortArrow = ({ field }: { field: string }) => {
    if (sortField !== field) return null;
    return <span className="ml-1 text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Monitor all workflow runs across projects.</p>
        </div>
      </header>

      <div className="border-b bg-muted/30 px-6 py-4">
        <div className="grid grid-cols-4 gap-4">
          <div className="rounded-lg border border-border/50 bg-card p-3 shadow-sm">
            <div className="text-xs font-medium text-muted-foreground">Total Runs</div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="mt-0.5 text-2xl font-bold tabular-nums text-foreground cursor-default">{loading ? '—' : stats.total}</div>
              </TooltipTrigger>
              <TooltipContent>Total workflow runs in the selected scope</TooltipContent>
            </Tooltip>
          </div>
          <div className="rounded-lg border border-border/50 bg-card p-3 shadow-sm">
            <div className="text-xs font-medium text-muted-foreground">Active</div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="mt-0.5 text-2xl font-bold tabular-nums text-info cursor-default">{loading ? '—' : stats.active}</div>
              </TooltipTrigger>
              <TooltipContent>Runs currently in progress or waiting</TooltipContent>
            </Tooltip>
          </div>
          <div className="rounded-lg border border-border/50 bg-card p-3 shadow-sm">
            <div className="text-xs font-medium text-muted-foreground">Success Rate</div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="mt-0.5 text-2xl font-bold tabular-nums text-success cursor-default">{loading ? '—' : `${stats.successRate}%`}</div>
              </TooltipTrigger>
              <TooltipContent>Percentage of resolved runs that completed</TooltipContent>
            </Tooltip>
          </div>
          <div className="rounded-lg border border-border/50 bg-card p-3 shadow-sm">
            <div className="text-xs font-medium text-muted-foreground">Cost</div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="mt-0.5 text-2xl font-bold tabular-nums text-foreground cursor-default">{loading ? '—' : `$${totalCost.toFixed(2)}`}</div>
              </TooltipTrigger>
              <TooltipContent>
                {totalTokens.toLocaleString()} total tokens consumed
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-b px-6 py-3">
        <Select value={filterProjectId} onValueChange={setFilterProjectId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="waiting">Waiting</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-1 items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ticket title…"
            className="max-w-xs"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          />
          <Button size="sm" variant="outline" onClick={handleSearch}>
            <SearchIcon data-icon="inline-start" />
            Search
          </Button>
        </div>
      </div>

      <main className="flex-1 overflow-auto p-6">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <ActivityIcon className="size-8 text-muted-foreground" />
            <p className="text-muted-foreground">No runs found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-4 py-3 font-medium">
                      <button onClick={() => toggleSort('ticket')} className="inline-flex items-center font-medium hover:text-foreground">Ticket <SortArrow field="ticket" /></button>
                    </th>
                    <th className="px-4 py-3 font-medium">
                      <button onClick={() => toggleSort('workflow')} className="inline-flex items-center font-medium hover:text-foreground">Workflow <SortArrow field="workflow" /></button>
                    </th>
                    <th className="px-4 py-3 font-medium">
                      <button onClick={() => toggleSort('status')} className="inline-flex items-center font-medium hover:text-foreground">Status <SortArrow field="status" /></button>
                    </th>
                    <th className="px-4 py-3 font-medium">
                      <button onClick={() => toggleSort('duration')} className="inline-flex items-center font-medium hover:text-foreground">Duration <SortArrow field="duration" /></button>
                    </th>
                    <th className="px-4 py-3 font-medium">
                      <button onClick={() => toggleSort('tokens')} className="inline-flex items-center font-medium hover:text-foreground">Tokens <SortArrow field="tokens" /></button>
                    </th>
                    <th className="px-4 py-3 font-medium">
                      <button onClick={() => toggleSort('cost')} className="inline-flex items-center font-medium hover:text-foreground">Cost <SortArrow field="cost" /></button>
                    </th>
                    <th className="px-4 py-3 font-medium">
                      <button onClick={() => toggleSort('created')} className="inline-flex items-center font-medium hover:text-foreground">Created <SortArrow field="created" /></button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRuns.map((run) => {
                  const duration = run.updatedAt && run.createdAt
                    ? Math.round((new Date(run.updatedAt).getTime() - new Date(run.createdAt).getTime()) / 1000)
                    : null;
                  return (
                    <tr
                      key={run.id}
                      className="cursor-pointer border-b hover:bg-muted/30"
                      onClick={() => openRun(run)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{run.ticketTitle ?? run.ticketId.slice(0, 8)}</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); navigate(`/?project=${run.projectId}`); }}
                                className="text-muted-foreground hover:text-foreground"
                                aria-label="Open in board"
                              >
                                <ExternalLinkIcon className="size-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>View ticket on the board</TooltipContent>
                          </Tooltip>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{run.workflowName}</td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[run.status] ?? 'outline'}>{run.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {duration !== null ? `${duration}s` : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {run.totalTokens ? run.totalTokens.toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {run.costUsd ? `$${run.costUsd.toFixed(4)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(run.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <Sheet open={!!selectedRun} onOpenChange={(open) => !open && setSelectedRun(null)}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Run Detail</SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-4 px-4 pb-6">
              {selectedRun && (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Ticket:</span>{' '}
                      {selectedRun.ticketTitle ?? selectedRun.ticketId.slice(0, 8)}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Workflow:</span>{' '}
                      {selectedRun.workflowName}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status:</span>{' '}
                      <Badge variant={STATUS_VARIANT[selectedRun.status] ?? 'outline'}>{selectedRun.status}</Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Tokens:</span>{' '}
                      {selectedRun.totalTokens?.toLocaleString() ?? '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cost:</span>{' '}
                      {selectedRun.costUsd ? `$${selectedRun.costUsd.toFixed(4)}` : '—'}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Branch:</span>{' '}
                      {selectedRun.branch ?? '—'}
                    </div>
                    {selectedRun.error && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Error:</span>{' '}
                        <span className="text-destructive">{selectedRun.error}</span>
                      </div>
                    )}
                  </div>

                  {runDetail && runDetail.nodes.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <h3 className="text-sm font-semibold">Nodes ({runDetail.nodes.length})</h3>
                      <div className="overflow-hidden rounded-lg border border-border/50">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50 text-left">
                              <th className="px-3 py-2 font-medium">Node</th>
                              <th className="px-3 py-2 font-medium">Type</th>
                              <th className="px-3 py-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {runDetail.nodes.map((n) => (
                              <tr key={n.nodeKey} className="border-b last:border-0">
                                <td className="px-3 py-2">{n.nodeKey}</td>
                                <td className="px-3 py-2 text-muted-foreground">{n.type}</td>
                                <td className="px-3 py-2">
                                  <Badge variant={n.status === 'failed' ? 'destructive' : n.status === 'completed' ? 'success' : 'outline'}>{n.status}</Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {selectedRun.diff && (
                    <div className="flex flex-col gap-2">
                      <h3 className="text-sm font-medium">Diff</h3>
                      <pre className="max-h-96 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
                        {selectedRun.diff}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}
