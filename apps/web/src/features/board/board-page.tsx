import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { SettingsIcon, SparklesIcon, HistoryIcon, PlusIcon, WorkflowIcon, XIcon } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { toast } from 'sonner';
import type { AgentTicketPreviewResponse, CreateTicketInput, Label, Ticket } from '@orion/models';
import { ALL_DEFAULT_TICKET_TYPES } from '@orion/models';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { api, ApiError } from '@/lib/api';
import { useProjectContext } from '@/lib/use-project-context';
import { ACCENT_PRESETS, type AccentKey } from '@/lib/use-branding';
import { useBoard, useLabels } from './hooks';
import { BoardSwimlane } from './board-swimlane';
import { TicketCardView } from './ticket-card';
import { BoardFilters, EMPTY_FILTERS, isFilterActive, type BoardFilterState } from './board-filters';
import { NewTicketSheet } from './new-ticket-sheet';
import { TicketSheet } from './ticket-sheet';
import { CreateTicketAiModal } from './create-ticket-ai-modal';
import { useBoardStream } from '@/lib/use-board-stream';

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

const BG_STORAGE_KEY = 'orion-board-background';

function loadBoardBg(): string {
  try {
    return localStorage.getItem(BG_STORAGE_KEY) ?? '';
  } catch { return ''; }
}

function saveBoardBg(value: string) {
  try { localStorage.setItem(BG_STORAGE_KEY, value); } catch { /* ignore */ }
}

type SortMode = 'order' | 'priority' | 'created' | 'due';

export function BoardPage() {
  const { projectId: urlProjectId } = useParams<{ projectId?: string }>();
  const { projectId: globalProjectId } = useProjectContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = urlProjectId ?? globalProjectId;
  const { board, loading: boardLoading, error: boardError, refetch: refetchBoard } = useBoard(projectId);
  const { labels, createLabel } = useLabels(projectId);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [draggingTicket, setDraggingTicket] = useState<Ticket | null>(null);
  const [filters, setFilters] = useState<BoardFilterState>(EMPTY_FILTERS);
  const [conflict, setConflict] = useState<{ ticketId: string; swimlane: string; activeRunId: string } | null>(null);
  const [boardBg, setBoardBg] = useState<string>(loadBoardBg);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [newTicketSwimlane, setNewTicketSwimlane] = useState<string | undefined>();
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [sortModes, setSortModes] = useState<Record<string, SortMode>>({});

  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrefill, setAiPrefill] = useState<AgentTicketPreviewResponse | null>(null);

  const navigate = useNavigate();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const allTickets = useMemo(
    () => board?.swimlanes.flatMap((c) => c.tickets) ?? [],
    [board],
  );
  const labelsById = useMemo(() => {
    const map = new Map<string, Label>();
    for (const label of labels) map.set(label.id, label);
    return map;
  }, [labels]);

  const ticketsById = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const t of allTickets) map.set(t.id, t);
    return map;
  }, [allTickets]);

  const epicTickets = useMemo(
    () => allTickets.filter((t) => t.type === 'epic'),
    [allTickets],
  );

  const availableTypes = useMemo(() => {
    if (board?.issueTypes && board.issueTypes.length > 0) {
      return board.issueTypes;
    }
    return ALL_DEFAULT_TICKET_TYPES;
  }, [board?.issueTypes]);

  const filtered = useMemo(() => {
    if (!board || !isFilterActive(filters)) return board;
    const query = filters.search.trim().toLowerCase();
    const matches = (ticket: Ticket): boolean => {
      if (query) {
        const haystack = `${ticket.title} ${ticket.description}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (filters.priority !== 'all' && ticket.priority !== filters.priority) return false;
      if (filters.labelIds.length > 0 && !filters.labelIds.every((id) => ticket.labelIds.includes(id))) {
        return false;
      }
      return true;
    };
    return {
      ...board,
      swimlanes: board.swimlanes.map((c) => ({ ...c, tickets: c.tickets.filter(matches) })),
    };
  }, [board, filters]);

  useEffect(() => {
    const ticketId = searchParams.get('ticket');
    if (!ticketId) return;
    const existing = allTickets.find((t) => t.id === ticketId);
    if (existing) {
      setActiveTicket(existing);
      return;
    }
    api.getTicketDetail(ticketId).then((detail) => {
      setActiveTicket(detail);
    }).catch(() => undefined);
  }, [searchParams, allTickets]);

  useBoardStream(projectId, () => {
    void refetchBoard();
  });

  const handleSortChange = useCallback((swimlane: string, mode: SortMode) => {
    setSortModes((prev) => ({ ...prev, [swimlane]: mode }));
  }, []);

  const handleAddTicketToSwimlane = useCallback((swimlane: string) => {
    setNewTicketSwimlane(swimlane);
    setNewTicketOpen(true);
  }, []);

  const onDragStart = (event: DragStartEvent) => {
    const ticket = allTickets.find((t) => t.id === String(event.active.id));
    setDraggingTicket(ticket ?? null);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setDraggingTicket(null);
    const ticketId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;

    const ticket = allTickets.find((t) => t.id === ticketId);
    if (!ticket) return;

    const overTicket = allTickets.find((t) => t.id === overId);
    if (overTicket) {
      if (ticket.swimlane === overTicket.swimlane) {
        const swimlane = board?.swimlanes.find((s) => s.key === ticket.swimlane);
        const oldIndex = swimlane?.tickets.findIndex((t) => t.id === ticketId);
        const tickets = swimlane?.tickets;
        if (tickets && oldIndex !== undefined && oldIndex !== -1) {
          const newIndex = tickets.findIndex((t) => t.id === overId);
          if (newIndex !== -1 && oldIndex !== newIndex) {
            await moveTicket(ticketId, ticket.swimlane, newIndex);
          }
        }
        return;
      }
      const overSwimlaneTickets = board?.swimlanes.find((s) => s.key === overTicket.swimlane)?.tickets;
      if (overSwimlaneTickets) {
        const targetIndex = overSwimlaneTickets.findIndex((t) => t.id === overId);
        await moveTicket(ticketId, overTicket.swimlane, targetIndex >= 0 ? targetIndex : undefined);
      }
      return;
    }

    const overSwimlane = board?.swimlanes.find((s) => s.key === overId);
    if (overSwimlane && ticket.swimlane !== overSwimlane.key) {
      await moveTicket(ticketId, overSwimlane.key);
    }
  };

  const moveTicket = async (ticketId: string, swimlane: string, order?: number, force?: string) => {
    try {
      const result = await api.moveTicket(ticketId, swimlane, order, force);
      refetchBoard();
      if (result.trigger) {
        if (result.trigger.action === 'started') {
          toast.success('Workflow started');
        } else if (result.trigger.action === 'retried') {
          toast.success('Workflow resumed');
        } else if (result.trigger.reason === 'mid-workflow-lane') {
          toast.info('Ticket moved — this lane belongs to an in-progress step, not the workflow start');
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const data = e.data as { activeRunId?: string } | undefined;
        setConflict({ ticketId, swimlane, activeRunId: data?.activeRunId ?? '' });
        return;
      }
      toast.error((e as Error).message);
    }
  };

  const createTicket = async (input: Omit<CreateTicketInput, 'projectId'>) => {
    if (!projectId) return;
    try {
      await api.createTicket(projectId, {
        ...input,
        swimlane: input.swimlane ?? board?.swimlanes[0]?.key,
      });
      toast.success('Ticket created');
      refetchBoard();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const createFromAi = async (preview: AgentTicketPreviewResponse, pid: string) => {
    const byName = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
    const resolvedLabels = preview.labels
      .map((n) => byName.get(n.toLowerCase()))
      .filter((id): id is string => id !== undefined);
    await api.createTicket(pid, {
      title: preview.title,
      description: preview.description,
      type: preview.type,
      priority: preview.priority as import('@orion/models').TicketPriority,
      labelIds: resolvedLabels.length > 0 ? resolvedLabels : [],
      swimlane: board?.swimlanes[0]?.key,
    });
    refetchBoard();
  };

  const handleOpenInForm = (preview: AgentTicketPreviewResponse) => {
    setAiPrefill(preview);
    setNewTicketOpen(true);
  };

  const handleBgChange = (value: string) => {
    setBoardBg(value);
    saveBoardBg(value);
  };

  const boardBgStyle: React.CSSProperties = boardBg
    ? { backgroundColor: boardBg }
    : {};

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Board</h1>
        </div>
        <div className="flex items-center gap-2">
          {board && (
            <>
              <BoardFilters filters={filters} labels={labels} onChange={setFilters} />

              <Button
                onClick={() => { setNewTicketSwimlane(undefined); setNewTicketOpen(true); }}
                className="max-lg:size-9 max-lg:px-0"
              >
                <PlusIcon data-icon="inline-start" className="max-lg:mx-auto" />
                <span className="hidden lg:inline">New ticket</span>
              </Button>
              <Button
                onClick={() => setAiModalOpen(true)}
                className="relative overflow-hidden bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white transition-all duration-300 hover:from-violet-700 hover:to-fuchsia-700 hover:shadow-[0_0_25px_rgba(139,92,246,0.5)] animate-pulse-glow max-lg:size-9 max-lg:px-0"
              >
                <SparklesIcon data-icon="inline-start" className="max-lg:mx-auto" />
                <span className="hidden lg:inline">Create with AI</span>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" title="Board settings">
                    <SettingsIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <span className="text-xs font-medium text-muted-foreground px-2 py-1">Board background</span>
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
                          borderColor: boardBg === preset.value ? 'var(--ring)' : 'var(--border)',
                        }}
                      />
                    ))}
                    {boardBg && (
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
                    <DropdownMenuItem onSelect={() => navigate(`/projects/${projectId}/builder`)}>
                      <WorkflowIcon className="size-4" />
                      Edit workflow
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-6" style={boardBgStyle}>
        {!projectId ? (
          <p className="text-muted-foreground">Create or select a project to see its board.</p>
        ) : boardError ? (
          <p className="text-destructive">{boardError}</p>
        ) : boardLoading || !board || !filtered ? (
          <div className="flex gap-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-96 w-80" />
            ))}
          </div>
        ) : (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="flex h-full gap-4 overflow-x-auto pb-4 items-start">
              {filtered.swimlanes.map((swimlane) => (
                <BoardSwimlane
                  key={swimlane.key}
                  swimlane={swimlane}
                  labelsById={labelsById}
                  ticketsById={ticketsById}
                  onOpenTicket={setActiveTicket}
                  onAddTicket={handleAddTicketToSwimlane}
                  sortBy={sortModes[swimlane.key] ?? 'order'}
                  onSortChange={handleSortChange}
                />
              ))}
            </div>
            <DragOverlay>
              {draggingTicket ? (
                <TicketCardView
                  ticket={draggingTicket}
                  labelsById={labelsById}
                  ticketsById={ticketsById}
                  className="w-72 cursor-grabbing rotate-2 shadow-xl"
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      <TicketSheet
        ticket={activeTicket}
        projectId={projectId}
        labels={labels}
        tickets={allTickets}
        epicTickets={epicTickets}
        swimlanes={board?.swimlanes ?? []}
        ticketTypes={availableTypes}
        onCreateLabel={createLabel}
        onClose={() => {
          setActiveTicket(null);
          if (searchParams.has('ticket')) {
            searchParams.delete('ticket');
            setSearchParams(searchParams, { replace: true });
          }
        }}
        onChanged={refetchBoard}
        onMoveTicket={async (ticketId, swimlane, force) => { await moveTicket(ticketId, swimlane, undefined, force); }}
      />

      <Dialog open={conflict !== null} onOpenChange={() => setConflict(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Active workflow in progress</DialogTitle>
            <DialogDescription>
              This ticket has a running workflow. To move it you must first cancel the run.
              The ticket will be moved after the run is cancelled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflict(null)}>
              Keep run
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!conflict) return;
                const c = conflict;
                setConflict(null);
                await moveTicket(c.ticketId, c.swimlane, undefined, 'cancel');
              }}
            >
              Cancel run & move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateTicketAiModal
        open={aiModalOpen}
        onOpenChange={setAiModalOpen}
        projectId={projectId}
        onCreate={createFromAi}
        onOpenInForm={handleOpenInForm}
      />

      <BoardActivitySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        projectId={projectId}
        tickets={allTickets}
      />

      {board && (
        <NewTicketSheet
          open={newTicketOpen}
          onOpenChange={(open) => {
            setNewTicketOpen(open);
            if (!open) {
              setNewTicketSwimlane(undefined);
              setAiPrefill(null);
            }
          }}
          swimlanes={board.swimlanes}
          labels={labels}
          tickets={allTickets}
          epicTickets={epicTickets}
          projectId={projectId}
          ticketTypes={availableTypes}
          prefill={aiPrefill}
          onPrefillConsumed={() => setAiPrefill(null)}
          onCreateLabel={createLabel}
          onCreate={createTicket}
          defaultSwimlane={newTicketSwimlane}
        />
      )}
    </div>
  );
}

function BoardActivitySheet({
  open,
  onOpenChange,
  projectId,
  tickets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  tickets: Ticket[];
}) {
  const [events, setEvents] = useState<Array<{ type: string; ticketId?: string; payload?: unknown; createdAt: string; ticket?: Ticket }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !projectId) return;
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
  }, [open, projectId, tickets]);

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
