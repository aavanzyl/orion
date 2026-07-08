import { useEffect, useMemo, useState } from 'react';
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
import type { CreateTicketInput, Label, Ticket } from '@orion/models';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useBoard, useLabels, useProjects, useProjectConfig } from './hooks';
import { BoardSwimlane } from './board-swimlane';
import { TicketCardView } from './ticket-card';
import { BoardFilters, EMPTY_FILTERS, isFilterActive, type BoardFilterState } from './board-filters';
import { NewTicketSheet } from './new-ticket-sheet';
import { TicketSheet } from './ticket-sheet';
import { useBoardStream } from '@/lib/use-board-stream';

export function BoardPage() {
  const { projects, loading: projectsLoading } = useProjects();
  const [projectId, setProjectId] = useState<string | null>(null);
  const { board, loading: boardLoading, error: boardError, refetch: refetchBoard } = useBoard(projectId);
  const { labels, createLabel } = useLabels(projectId);
  const { config } = useProjectConfig(projectId);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [draggingTicket, setDraggingTicket] = useState<Ticket | null>(null);
  const [filters, setFilters] = useState<BoardFilterState>(EMPTY_FILTERS);

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
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId]);

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
    try {
      await api.moveTicket(ticketId, swimlane);
      refetchBoard();
    } catch (e) {
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
            <NewTicketSheet
              swimlanes={board.swimlanes}
              labels={labels}
              tickets={allTickets}
              onCreateLabel={createLabel}
              onCreate={createTicket}
            />
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
                  onOpenTicket={setActiveTicket}
                  triggerWorkflow={config?.board?.triggers?.[swimlane.key]}
                />
              ))}
            </div>
            <DragOverlay>
              {draggingTicket ? (
                <TicketCardView
                  ticket={draggingTicket}
                  labelsById={labelsById}
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
        swimlanes={board?.swimlanes ?? []}
        onCreateLabel={createLabel}
        onClose={() => setActiveTicket(null)}
        onChanged={refetchBoard}
      />
    </div>
  );
}
