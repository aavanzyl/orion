import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HistoryIcon, PencilIcon, PlusIcon, SearchIcon, SettingsIcon, SparklesIcon, TicketIcon, TrashIcon, WorkflowIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { AgentTicketPreviewResponse, Label as LabelModel, Ticket, TicketPriority, TicketType } from '@orion/models';
import { ALL_DEFAULT_TICKET_TYPES } from '@orion/models';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { api } from '@/lib/api';
import { CreateTicketAiModal } from '@/features/board/create-ticket-ai-modal';
import { useProjects } from '@/features/projects/hooks';
import { useProjectContext } from '@/lib/use-project-context';
import { ACCENT_PRESETS, type AccentKey } from '@/lib/use-branding';
import { BoardFilters, EMPTY_FILTERS, type BoardFilterState } from '@/features/board/board-filters';
import { IssueDetailSheet } from './issue-detail-sheet';

const BG_PRESETS = [
  { label: 'Default', value: '', bg: undefined as string | undefined },
  ...(Object.entries(ACCENT_PRESETS) as [AccentKey, { label: string; hue: number }][]).map(
    ([key, { label, hue }]) => ({
      label,
      value: key,
      bg: `oklch(0.95 0.025 ${hue})`,
    }),
  ),
];

const BG_STORAGE_KEY = 'orion-issues-background';

function loadBg(): string {
  try {
    return localStorage.getItem(BG_STORAGE_KEY) ?? '';
  } catch { return ''; }
}

function saveBg(value: string) {
  try { localStorage.setItem(BG_STORAGE_KEY, value); } catch { /* ignore */ }
}

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

type SortField = 'key' | 'title' | 'swimlane' | 'priority' | 'type' | 'labels' | 'createdAt' | 'updatedAt';
type SortDir = 'asc' | 'desc';

export function IssuesPage() {
  const { projects } = useProjects();
  const { projectId: globalProjectId } = useProjectContext();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [labels, setLabels] = useState<LabelModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<BoardFilterState>(EMPTY_FILTERS);
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [newTicketTitle, setNewTicketTitle] = useState('');
  const [newTicketType, setNewTicketType] = useState<TicketType>('feature');
  const [newTicketCreating, setNewTicketCreating] = useState(false);

  const [deletingTicketId, setDeletingTicketId] = useState<string | null>(null);

  const [aiModalOpen, setAiModalOpen] = useState(false);

  const [bg, setBg] = useState<string>(loadBg);
  const [historyOpen, setHistoryOpen] = useState(false);

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
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.displayKey ?? '').toLowerCase().includes(q) ||
          t.swimlane.toLowerCase().includes(q) ||
          (t.workflowName ?? '').toLowerCase().includes(q) ||
          (projectMap.get(t.projectId)?.name ?? '').toLowerCase().includes(q),
      );
    }
    if (globalProjectId) {
      result = result.filter((t) => t.projectId === globalProjectId);
    }
    if (filters.priority !== 'all') {
      result = result.filter((t) => t.priority === filters.priority);
    }
    if (filters.labelIds.length > 0) {
      result = result.filter((t) => filters.labelIds.every((id) => t.labelIds.includes(id)));
    }
    return result;
  }, [tickets, filters, globalProjectId, projectMap]);

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
        case 'swimlane':
          cmp = a.swimlane.localeCompare(b.swimlane);
          break;
        case 'priority':
          cmp = a.priority - b.priority;
          break;
        case 'type':
          cmp = a.type.localeCompare(b.type);
          break;
        case 'labels': {
          const la = (a.labelIds ?? []).length;
          const lb = (b.labelIds ?? []).length;
          cmp = la - lb;
          break;
        }
        case 'createdAt':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'updatedAt':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

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
  };

  const createTicket = async () => {
    if (!globalProjectId || !newTicketTitle.trim()) return;
    setNewTicketCreating(true);
    try {
      await api.createTicket(globalProjectId, { title: newTicketTitle.trim(), type: newTicketType });
      toast.success('Ticket created');
      setNewTicketOpen(false);
      setNewTicketTitle('');
      setNewTicketType('feature');
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setNewTicketCreating(false);
    }
  };

  const createFromAi = async (preview: AgentTicketPreviewResponse, pid: string) => {
    await api.createTicket(pid, {
      title: preview.title,
      description: preview.description,
      type: preview.type,
      priority: preview.priority as TicketPriority,
    });
    load();
  };

  const confirmDelete = async () => {
    if (!deletingTicketId) return;
    try {
      await api.deleteTicket(deletingTicketId);
      setTickets((prev) => prev.filter((t) => t.id !== deletingTicketId));
      toast.success('Ticket deleted');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleBgChange = (value: string) => {
    setBg(value);
    saveBg(value);
  };

  const bgStyle: React.CSSProperties = bg
    ? { backgroundColor: bg }
    : {};

  const hasResults = sorted.length > 0;

  const SortHead = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <TableHead>
      <button
        onClick={() => toggleSort(field)}
        className="inline-flex items-center font-medium hover:text-foreground"
      >
        {children} <SortArrow field={field} />
      </button>
    </TableHead>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Issues</h1>
        </div>
        <div className="flex items-center gap-2">
          <BoardFilters filters={filters} labels={labels} onChange={setFilters} />

          <Button onClick={() => setNewTicketOpen(true)} className="max-lg:size-9 max-lg:px-0">
            <PlusIcon data-icon="inline-start" className="max-lg:mx-auto" />
            <span className="hidden lg:inline">New ticket</span>
          </Button>
          <Button
            onClick={() => setAiModalOpen(true)}
            disabled={projects.length === 0}
            className="relative overflow-hidden bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white transition-all duration-300 hover:from-violet-700 hover:to-fuchsia-700 hover:shadow-[0_0_25px_rgba(139,92,246,0.5)] animate-pulse-glow max-lg:size-9 max-lg:px-0"
          >
            <SparklesIcon data-icon="inline-start" className="max-lg:mx-auto" />
            <span className="hidden lg:inline">Create with AI</span>
          </Button>

          {globalProjectId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" title="Issues settings">
                  <SettingsIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <span className="text-xs font-medium text-muted-foreground px-2 py-1">Background</span>
                <div className="flex flex-wrap gap-1.5 px-2 pb-2">
                  {BG_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => handleBgChange(preset.value)}
                      title={preset.label}
                      className="size-7 rounded-full border-2 transition-all hover:scale-110"
                      style={{
                        backgroundColor: preset.bg ?? 'var(--background)',
                        borderColor: bg === preset.value ? 'var(--ring)' : 'var(--border)',
                      }}
                    />
                  ))}
                  {bg && (
                    <button
                      type="button"
                      onClick={() => handleBgChange('')}
                      className="size-7 rounded-full border-2 border-border flex items-center justify-center hover:bg-muted"
                      title="Reset"
                    >
                      <XIcon className="size-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                    <HistoryIcon className="size-4" />
                    Board activity
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate(`/projects/${globalProjectId}/builder`)}>
                    <WorkflowIcon className="size-4" />
                    Edit workflow
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6" style={bgStyle}>
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : loading ? (
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
                  <SortHead field="key">Key</SortHead>
                  <SortHead field="title">Title</SortHead>
                  <SortHead field="swimlane">Swimlane</SortHead>
                  <SortHead field="priority">Priority</SortHead>
                  <SortHead field="type">Type</SortHead>
                  <SortHead field="labels">Labels</SortHead>
                  <SortHead field="createdAt">Created</SortHead>
                  <SortHead field="updatedAt">Updated</SortHead>
                  <TableHead className="w-16" />
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
                      <TableCell className="text-muted-foreground">
                        {titleize(ticket.swimlane)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={priority.variant}>{priority.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{ticket.type}</Badge>
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
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(ticket.createdAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(ticket.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            aria-label="Edit ticket"
                          >
                            <PencilIcon className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingTicketId(ticket.id);
                            }}
                            className="rounded p-1 text-destructive hover:bg-destructive/10"
                            aria-label="Delete ticket"
                          >
                            <TrashIcon className="size-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      <Dialog open={newTicketOpen} onOpenChange={setNewTicketOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New ticket</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-ticket-title">Title</Label>
              <Input
                id="new-ticket-title"
                value={newTicketTitle}
                onChange={(e) => setNewTicketTitle(e.target.value)}
                placeholder="Ticket title"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createTicket();
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Select value={newTicketType} onValueChange={(v) => setNewTicketType(v as TicketType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_DEFAULT_TICKET_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={createTicket} disabled={!globalProjectId || !newTicketTitle.trim() || newTicketCreating}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deletingTicketId !== null}
        onOpenChange={(open) => { if (!open) setDeletingTicketId(null); }}
        title="Delete ticket"
        description="Are you sure you want to permanently delete this ticket? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />

      <IssueDetailSheet
        ticket={selectedTicket}
        onClose={() => setSelectedTicket(null)}
        onChanged={handleChanged}
      />

      <CreateTicketAiModal
        open={aiModalOpen}
        onOpenChange={setAiModalOpen}
        projectId={projects[0]?.id ?? null}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        onCreate={createFromAi}
      />

      <IssuesActivitySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        tickets={tickets}
      />
    </div>
  );
}

function IssuesActivitySheet({
  open,
  onOpenChange,
  tickets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tickets: Ticket[];
}) {
  const [events, setEvents] = useState<Array<{ type: string; ticketId?: string; payload?: unknown; createdAt: string; ticket?: Ticket }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all(
      tickets.slice(0, 50).map((t) =>
        api.listTicketLogs(t.id, { limit: 20 }).then((logs) =>
          logs.map((e) => ({ ...e, ticketId: t.id, ticket: t })),
        ).catch(() => []),
      ),
    )
      .then((results) => {
        const all = results.flat().filter((e) =>
          ['ticket.moved', 'ticket.updated', 'ticket.created', 'ticket.deleted', 'ticket.comment', 'run.created', 'run.status'].includes(e.type),
        );
        all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setEvents(all.slice(0, 100));
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [open, tickets]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3 shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <HistoryIcon className="size-4" />
            Board Activity
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col gap-1 p-4">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity.</p>
            ) : (
              events.map((event, i) => {
                const eventLabel = EVENT_LABELS[event.type] ?? event.type;
                const time = new Date(event.createdAt).toLocaleString();
                return (
                  <div key={i} className="flex items-start gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                    <span className="text-xs text-muted-foreground shrink-0 w-24 pt-0.5">
                      {time.split(',')[0]}
                    </span>
                    <div className="min-w-0">
                      <span className="font-medium">{eventLabel}</span>
                      {event.ticket && (
                        <span className="text-muted-foreground"> — {event.ticket.title}</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

const EVENT_LABELS: Record<string, string> = {
  'ticket.created': 'Ticket created',
  'ticket.updated': 'Ticket updated',
  'ticket.moved': 'Ticket moved',
  'ticket.deleted': 'Ticket deleted',
  'ticket.comment': 'Comment added',
  'run.created': 'Workflow started',
  'run.status': 'Workflow updated',
};
