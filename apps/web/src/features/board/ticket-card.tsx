import { forwardRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { GitBranchIcon } from 'lucide-react';
import type { Label, Ticket } from '@orion/models';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PriorityIcon } from './priority';

interface TicketCardProps {
  ticket: Ticket;
  labelsById: Map<string, Label>;
  onOpen: (ticket: Ticket) => void;
}

interface TicketCardViewProps extends React.ComponentProps<typeof Card> {
  ticket: Ticket;
  labelsById: Map<string, Label>;
}

export const TicketCardView = forwardRef<HTMLDivElement, TicketCardViewProps>(
  ({ ticket, labelsById, className, ...props }, ref) => {
    const ticketLabels = ticket.labelIds
      .map((id) => labelsById.get(id))
      .filter((l): l is Label => Boolean(l));

    const priorityStyle = (() => {
      switch (ticket.priority) {
        case 1: return 'border-l-4 border-l-destructive bg-destructive/5';
        case 2: return 'border-l-4 border-l-warning bg-warning/5';
        case 3: return 'border-l-4 border-l-info bg-info/5';
        case 4: return 'border-l-4 border-l-muted-foreground/30 bg-muted/20';
        default: return '';
      }
    })();

    return (
      <Card ref={ref} className={cn('cursor-grab gap-3 py-4 transition-all hover:shadow-md hover:border-ring/50', priorityStyle, className)} {...props}>
        <CardHeader className="px-4">
          <CardTitle className="flex items-start gap-2 text-sm leading-snug">
            {ticket.priority > 0 && <PriorityIcon priority={ticket.priority} className="mt-0.5 shrink-0" />}
            <span>{ticket.title}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-1.5 px-4">
          {ticketLabels.map((label) => (
            <Badge key={label.id} variant="outline" className="gap-2 text-xs">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: label.color }} />
              {label.name}
            </Badge>
          ))}
          {ticket.parentId && (
            <Badge variant="ghost" className="text-muted-foreground">
              <GitBranchIcon data-icon="inline-start" />
              sub-issue
            </Badge>
          )}
        </CardContent>
      </Card>
    );
  },
);
TicketCardView.displayName = 'TicketCardView';

export function TicketCard({ ticket, labelsById, onOpen }: TicketCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: ticket.id,
  });

  return (
    <TicketCardView
      ticket={ticket}
      labelsById={labelsById}
      ref={setNodeRef}
      className={cn(isDragging && 'opacity-40')}
      onClick={() => onOpen(ticket)}
      {...listeners}
      {...attributes}
    />
  );
}
