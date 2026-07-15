import { forwardRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CalendarIcon, GitBranchIcon } from 'lucide-react';
import { ALL_DEFAULT_TICKET_TYPES, type Label, type Ticket } from '@orion/models';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PriorityIcon } from './priority';

interface TicketCardProps {
  ticket: Ticket;
  labelsById: Map<string, Label>;
  ticketsById: Map<string, Ticket>;
  onOpen: (ticket: Ticket) => void;
}

interface TicketCardViewProps extends React.ComponentProps<typeof Card> {
  ticket: Ticket;
  labelsById: Map<string, Label>;
  ticketsById: Map<string, Ticket>;
}

export const TicketCardView = forwardRef<HTMLDivElement, TicketCardViewProps>(
  ({ ticket, labelsById, ticketsById, className, ...props }, ref) => {
    const ticketLabels = ticket.labelIds
      .map((id) => labelsById.get(id))
      .filter((l): l is Label => Boolean(l));

    const epicTicket = ticket.epicId ? ticketsById.get(ticket.epicId) : undefined;

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
          <Badge variant="secondary" className="text-xs capitalize">
            {ALL_DEFAULT_TICKET_TYPES.find((t) => t.value === ticket.type)?.label ?? ticket.type}
          </Badge>
          {epicTicket && (
            <Badge variant="outline" className="gap-1.5 text-xs">
              <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: '#7c3aed' }} />
              {epicTicket.title}
            </Badge>
          )}
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
          {ticket.dueDate && (
            <Badge variant="ghost" className={cn('text-xs', isPastDue(ticket.dueDate) && 'text-destructive')}>
              <CalendarIcon data-icon="inline-start" />
              {formatDueDate(ticket.dueDate)}
            </Badge>
          )}
        </CardContent>
      </Card>
    );
  },
);
TicketCardView.displayName = 'TicketCardView';

export function TicketCard({ ticket, labelsById, ticketsById, onOpen }: TicketCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: ticket.id,
  });

  return (
    <TicketCardView
      ticket={ticket}
      labelsById={labelsById}
      ticketsById={ticketsById}
      ref={setNodeRef}
      className={cn(isDragging && 'opacity-40')}
      onClick={() => onOpen(ticket)}
      {...listeners}
      {...attributes}
    />
  );
}

function formatDueDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isPastDue(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}
