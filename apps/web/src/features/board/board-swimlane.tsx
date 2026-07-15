import { useDroppable } from '@dnd-kit/core';
import type { BoardSwimlane, Label, Ticket } from '@orion/models';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { TicketCard } from './ticket-card';

interface BoardSwimlaneProps {
  swimlane: BoardSwimlane;
  labelsById: Map<string, Label>;
  ticketsById: Map<string, Ticket>;
  onOpenTicket: (ticket: Ticket) => void;
}

export function BoardSwimlane({ swimlane, labelsById, ticketsById, onOpenTicket }: BoardSwimlaneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: swimlane.key });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-80 shrink-0 flex-col rounded-xl border border-border/50 bg-card shadow-sm',
        isOver && 'ring-2 ring-ring border-ring',
      )}
    >
      <div className="flex flex-col gap-1.5 border-b border-border/40 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">{swimlane.title}</h2>
          <Badge variant="secondary" className="tabular-nums">{swimlane.tickets.length}</Badge>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-3 p-3">
          {swimlane.tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              labelsById={labelsById}
              ticketsById={ticketsById}
              onOpen={onOpenTicket}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
