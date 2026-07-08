import { useEffect, useMemo, useState } from 'react';
import { SearchIcon, TicketIcon } from 'lucide-react';
import type { Label as LabelModel, Ticket, TicketPriority } from '@orion/models';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { useProjects } from '@/features/projects/hooks';
import { IssueDetailSheet } from './issue-detail-sheet';

const PRIORITY_MAP: Record<TicketPriority, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' }> = {
  0: { label: 'None', variant: 'outline' },
  1: { label: 'Urgent', variant: 'destructive' },
  2: { label: 'High', variant: 'warning' },
  3: { label: 'Medium', variant: 'info' },
  4: { label: 'Low', variant: 'secondary' },
};

function titleize(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type SortField = 'key' | 'title' | 'project' | 'swimlane' | 'priority' | 'workflow' | 'createdAt' | 'updatedAt';
type SortDir = 'asc' | 'desc';

export function IssuesPage() {
  const { projects, loading: projectsLoading, refetch: refetchProjects } = useProjects();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [labels, setLabels] = useState<LabelModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filterProject, setFilterProject] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([api.listAllTickets(), api.listAllLabels()])
      .then(([t, l]) => {
        setTickets(t);
        setLabels(l);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const labelMap = useMemo(() => {
    const map = new Map<string, LabelModel>();
    for (const l of labels) map.set(l.id, l);
    return map;
  }, [labels]);

  const filtered = useMemo(() => {
    let result = tickets;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.displayKey ?? '').toLowerCase().includes(q) ||
          t.swimlane.toLowerCase().includes(q) ||
          (t.workflowName ?? '').toLowerCase().includes(q) ||
          (projectMap.get(t.projectId)?.name ?? '').toLowerCase().includes(q),
      );
    }
    if (filterProject !== 'all') {
      result = result.filter((t) => t.projectId === filterProject);
    }
    if (filterPriority !== 'all') {
      result = result.filter((t) => t.priority === Number(filterPriority));
    }
    return result;
  }, [tickets, search, filterProject, filterPriority, projectMap]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'key':
          cmp = (a.displayKey ?? '').localeCompare(b.displayKey ?? '');
          break;
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'project': {
          const pa = projectMap.get(a.projectId)?.name ?? a.projectId;
          const pb = projectMap.get(b.projectId)?.name ?? b.projectId;
          cmp = pa.localeCompare(pb);
          break;
        }
        case 'swimlane':
          cmp = a.swimlane.localeCompare(b.swimlane);
          break;
        case 'priority':
          cmp = a.priority - b.priority;
          break;
        case 'workflow':
          cmp = (a.workflowName ?? '').localeCompare(b.workflowName ?? '');
          break;
        case 'createdAt':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'updatedAt':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir, projectMap]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortArrow = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return <span className="ml-1 text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const handleChanged = () => {
    load();
    refetchProjects();
  };

  const isFiltering = search.trim() || filterProject !== 'all' || filterPriority !== 'all';
  const hasResults = sorted.length > 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Issues</h1>
          <p className="text-sm text-muted-foreground">
            View and search all tickets across projects.
          </p>
        </div>
      </header>

      <div className="flex items-center gap-3 border-b bg-card px-6 py-3">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tickets…"
            className="h-9 max-w-sm pl-8"
          />
        </div>
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder="All priorities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {([1, 2, 3, 4, 0] as TicketPriority[]).map((p) => (
              <SelectItem key={p} value={String(p)}>
                {PRIORITY_MAP[p].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {sorted.length} of {tickets.length}
          {isFiltering && ' filtered'}
        </span>
      </div>

      <main className="flex-1 overflow-auto p-6">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : loading || projectsLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <TicketIcon className="size-8 text-muted-foreground" />
            <p className="text-muted-foreground">No tickets yet.</p>
          </div>
        ) : !hasResults ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <SearchIcon className="size-8 text-muted-foreground" />
            <p className="text-muted-foreground">No tickets match your filters.</p>
          </div>
        ) : (
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button
                      onClick={() => toggleSort('key')}
                      className="inline-flex items-center font-medium hover:text-foreground"
                    >
                      Key <SortArrow field="key" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort('title')}
                      className="inline-flex items-center font-medium hover:text-foreground"
                    >
                      Title <SortArrow field="title" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort('project')}
                      className="inline-flex items-center font-medium hover:text-foreground"
                    >
                      Project <SortArrow field="project" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort('swimlane')}
                      className="inline-flex items-center font-medium hover:text-foreground"
                    >
                      Swimlane <SortArrow field="swimlane" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort('priority')}
                      className="inline-flex items-center font-medium hover:text-foreground"
                    >
                      Priority <SortArrow field="priority" />
                    </button>
                  </TableHead>
                  <TableHead>Labels</TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort('workflow')}
                      className="inline-flex items-center font-medium hover:text-foreground"
                    >
                      Workflow <SortArrow field="workflow" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort('createdAt')}
                      className="inline-flex items-center font-medium hover:text-foreground"
                    >
                      Created <SortArrow field="createdAt" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort('updatedAt')}
                      className="inline-flex items-center font-medium hover:text-foreground"
                    >
                      Updated <SortArrow field="updatedAt" />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((ticket) => {
                  const priority = PRIORITY_MAP[ticket.priority];
                  const ticketLabels = ticket.labelIds
                    .map((id) => labelMap.get(id))
                    .filter((l): l is LabelModel => !!l);
                  return (
                    <TableRow
                      key={ticket.id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => setSelectedTicket(ticket)}
                    >
                      <TableCell className="whitespace-nowrap font-mono text-sm text-muted-foreground">
                        {ticket.displayKey ?? '—'}
                      </TableCell>
                      <TableCell className="font-medium max-w-80">
                        <span className="block truncate">{ticket.title}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {projectMap.get(ticket.projectId)?.name ?? ticket.projectId}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {titleize(ticket.swimlane)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={priority.variant}>{priority.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {ticketLabels.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            ticketLabels.slice(0, 3).map((label) => (
                              <Badge key={label.id} variant="outline" className="gap-1 text-xs">
                                <span
                                  className="size-1.5 rounded-full"
                                  style={{ backgroundColor: label.color }}
                                />
                                {label.name}
                              </Badge>
                            ))
                          )}
                          {ticketLabels.length > 3 && (
                            <span className="text-xs text-muted-foreground">
                              +{ticketLabels.length - 3}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {ticket.workflowName ? titleize(ticket.workflowName) : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(ticket.createdAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(ticket.updatedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      <IssueDetailSheet
        ticket={selectedTicket}
        onClose={() => setSelectedTicket(null)}
        onChanged={handleChanged}
      />
    </div>
  );
}
