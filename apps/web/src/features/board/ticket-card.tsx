import { useState, forwardRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CalendarIcon, CheckCircle2Icon, GitBranchIcon, PencilIcon } from 'lucide-react';
import type { WaitingRunInfo } from '@orion/models';
import { ALL_DEFAULT_TICKET_TYPES, type Label, type Ticket } from '@orion/models';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PriorityIcon } from './priority';

interface TicketCardProps {
  ticket: Ticket;
  labelsById: Map<string, Label>;
  ticketsById: Map<string, Ticket>;
  onOpen: (ticket: Ticket) => void;
  waitingRun?: WaitingRunInfo;
  onReview?: (runId: string, nodeKey: string) => void;
}

interface TicketCardViewProps extends React.ComponentProps<typeof Card> {
  ticket: Ticket;
  labelsById: Map<string, Label>;
  ticketsById: Map<string, Ticket>;
  waitingRun?: WaitingRunInfo;
  onReview?: (runId: string, nodeKey: string) => void;
}

export const TicketCardView = forwardRef<HTMLDivElement, TicketCardViewProps>(
  ({ ticket, labelsById, ticketsById, waitingRun, onReview, className, style, ...props }, ref) => {
    const [isHovered, setIsHovered] = useState(false);

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
      <Card
        ref={ref}
        className={cn('relative cursor-grab transition-all hover:shadow-md hover:border-ring/50', waitingRun ? 'pt-4 pb-0 gap-2' : 'gap-3 py-4', priorityStyle, className)}
        style={style}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        {...props}
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'absolute top-1.5 right-1.5 size-7 transition-opacity',
            isHovered ? 'opacity-100' : 'opacity-0',
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (props.onClick) {
              (props.onClick as unknown as (e: React.MouseEvent<HTMLButtonElement>) => void)(e);
            }
          }}
        >
          <PencilIcon className="size-3.5" />
        </Button>
        <CardHeader className="px-4">
          <CardTitle className="flex items-start gap-2 text-sm leading-snug pr-5">
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
        {waitingRun && onReview && (
          <Button
            variant="default"
            size="sm"
            className="w-full h-8 text-xs rounded-none rounded-b-[calc(var(--radius)-1px)] font-medium"
            onClick={(e) => {
              e.stopPropagation();
              onReview(waitingRun.runId, waitingRun.nodeKey);
            }}
          >
            <CheckCircle2Icon data-icon="inline-start" />
            Review changes
          </Button>
        )}
      </Card>
    );
  },
);
TicketCardView.displayName = 'TicketCardView';

export function TicketCard({ ticket, labelsById, ticketsById, onOpen, waitingRun, onReview }: TicketCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: ticket.id,
    data: { ticket, swimlane: ticket.swimlane },
  });

  return (
    <TicketCardView
      ticket={ticket}
      labelsById={labelsById}
      ticketsById={ticketsById}
      waitingRun={waitingRun}
      onReview={onReview}
      ref={setNodeRef}
      className={cn(isDragging && 'opacity-40')}
      onClick={() => onOpen(ticket)}
      {...attributes}
      {...listeners}
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
