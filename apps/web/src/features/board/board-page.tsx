import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { SparklesIcon } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { api, ApiError } from '@/lib/api';
import { useBoard, useLabels, useProjects } from './hooks';
import { BoardSwimlane } from './board-swimlane';
import { TicketCardView } from './ticket-card';
import { BoardFilters, EMPTY_FILTERS, isFilterActive, type BoardFilterState } from './board-filters';
import { NewTicketSheet } from './new-ticket-sheet';
import { TicketSheet } from './ticket-sheet';
import { CreateTicketAiModal } from './create-ticket-ai-modal';
import { useBoardStream } from '@/lib/use-board-stream';

export function BoardPage() {
  const { projectId: urlProjectId } = useParams<{ projectId?: string }>();
  const { projects, loading: projectsLoading } = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projectId, setProjectId] = useState<string | null>(urlProjectId ?? null);
  const { board, loading: boardLoading, error: boardError, refetch: refetchBoard } = useBoard(projectId);
  const { labels, createLabel } = useLabels(projectId);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [draggingTicket, setDraggingTicket] = useState<Ticket | null>(null);
  const [filters, setFilters] = useState<BoardFilterState>(EMPTY_FILTERS);
  const [conflict, setConflict] = useState<{ ticketId: string; swimlane: string; activeRunId: string } | null>(null);

  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrefill, setAiPrefill] = useState<AgentTicketPreviewResponse | null>(null);

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
    if (urlProjectId) return;
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0].id);
    }
  }, [urlProjectId, projects, projectId]);

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

  const onDragStart = (event: DragStartEvent) => {
    const ticket = allTickets.find((t) => t.id === String(event.active.id));
    setDraggingTicket(ticket ?? null);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setDraggingTicket(null);
    const ticketId = String(event.active.id);
    const swimlane = event.over ? String(event.over.id) : null;
    if (!swimlane) return;
    const ticket = allTickets.find((t) => t.id === ticketId);
    if (!ticket || ticket.swimlane === swimlane) return;
    await moveTicket(ticketId, swimlane);
  };

  const moveTicket = async (ticketId: string, swimlane: string, force?: string) => {
    try {
      const result = await api.moveTicket(ticketId, swimlane, undefined, force);
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
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Board</h1>
          <Select value={projectId ?? undefined} onValueChange={setProjectId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={projectsLoading ? 'Loading…' : 'Select a project'} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {board && (
            <>
              <NewTicketSheet
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
              />
              <Button
                onClick={() => setAiModalOpen(true)}
                className="relative overflow-hidden bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white transition-all duration-300 hover:from-violet-700 hover:to-fuchsia-700 hover:shadow-[0_0_25px_rgba(139,92,246,0.5)] animate-pulse-glow"
              >
                <SparklesIcon data-icon="inline-start" />
                Create with AI
              </Button>
            </>
          )}
        </div>
      </header>

      {projectId && board && (
        <div className="border-b bg-card px-6 py-3">
          <BoardFilters filters={filters} labels={labels} onChange={setFilters} />
        </div>
      )}

      <main className="flex-1 overflow-hidden p-6">
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
            <div className="flex h-full gap-4 overflow-x-auto pb-4">
              {filtered.swimlanes.map((swimlane) => (
                <BoardSwimlane
                  key={swimlane.key}
                  swimlane={swimlane}
                  labelsById={labelsById}
                  ticketsById={ticketsById}
                  onOpenTicket={setActiveTicket}
                />
              ))}
            </div>
            <DragOverlay>
              {draggingTicket ? (
                <TicketCardView
                  ticket={draggingTicket}
                  labelsById={labelsById}
                  ticketsById={ticketsById}
                  className="w-80 cursor-grabbing rotate-2 shadow-xl"
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
        onMoveTicket={moveTicket}
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
                await moveTicket(c.ticketId, c.swimlane, 'cancel');
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

    </div>
  );
}
