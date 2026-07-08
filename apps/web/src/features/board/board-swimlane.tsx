import { useDroppable } from '@dnd-kit/core';
import { ZapIcon } from 'lucide-react';
import type { BoardSwimlane, Label, Ticket } from '@orion/models';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { TicketCard } from './ticket-card';

interface BoardSwimlaneProps {
  swimlane: BoardSwimlane;
  labelsById: Map<string, Label>;
  onOpenTicket: (ticket: Ticket) => void;
  triggerWorkflow?: string | string[];
}

export function BoardSwimlane({ swimlane, labelsById, onOpenTicket, triggerWorkflow }: BoardSwimlaneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: swimlane.key });
  const triggerNames = triggerWorkflow
    ? Array.isArray(triggerWorkflow)
      ? triggerWorkflow
      : [triggerWorkflow]
    : [];

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
        {triggerNames.map((name) => (
          <Badge
            key={name}
            variant="outline"
            className="w-fit gap-1 text-muted-foreground"
            title={`Moving a ticket here runs the "${name}" workflow`}
          >
            <ZapIcon data-icon="inline-start" />
            runs {name}
          </Badge>
        ))}
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-3 p-3">
          {swimlane.tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              labelsById={labelsById}
              onOpen={onOpenTicket}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
