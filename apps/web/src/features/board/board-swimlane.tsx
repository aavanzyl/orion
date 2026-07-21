import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { EllipsisVerticalIcon, PlusIcon, ArrowUpDownIcon, ChevronRightIcon } from 'lucide-react';
import type { BoardSwimlane, Label, Ticket } from '@orion/models';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { TicketCard } from './ticket-card';

interface BoardSwimlaneProps {
  swimlane: BoardSwimlane;
  labelsById: Map<string, Label>;
  ticketsById: Map<string, Ticket>;
  onOpenTicket: (ticket: Ticket) => void;
  onAddTicket: (swimlane: string) => void;
  sortBy: 'order' | 'priority' | 'created' | 'due';
  onSortChange: (swimlane: string, sort: 'order' | 'priority' | 'created' | 'due') => void;
}

const SORT_LABELS: Record<string, string> = {
  order: 'Default order',
  priority: 'Priority',
  created: 'Created date',
  due: 'Due date',
};

const SORT_ICONS: Record<string, React.ReactNode> = {
  order: <ArrowUpDownIcon className="size-3.5" />,
  priority: <ArrowUpDownIcon className="size-3.5" />,
  created: <ArrowUpDownIcon className="size-3.5" />,
  due: <ArrowUpDownIcon className="size-3.5" />,
};

export function BoardSwimlane({
  swimlane,
  labelsById,
  ticketsById,
  onOpenTicket,
  onAddTicket,
  sortBy,
  onSortChange,
}: BoardSwimlaneProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const { setNodeRef, isOver } = useDroppable({ id: swimlane.key });

  const sortedTickets = sortTickets(swimlane.tickets, sortBy);

  return (
    <div
      className={cn(
        'flex w-80 shrink-0 flex-col rounded-xl border border-border/50 bg-card/90 shadow-sm max-h-[85vh]',
        isOver && 'ring-2 ring-ring border-ring',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-4 py-3 shrink-0">
        <div className="flex items-center gap-1 min-w-0">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="shrink-0 rounded-sm p-0.5 hover:bg-accent"
          >
            <ChevronRightIcon
              className={cn('size-4 transition-transform', !collapsed && 'rotate-90')}
            />
          </button>
          <h2 className="text-sm font-semibold tracking-tight truncate">{swimlane.title}</h2>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Badge variant="secondary" className="tabular-nums h-5 min-w-5 flex items-center justify-center">
            {swimlane.tickets.length}
          </Badge>
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <EllipsisVerticalIcon className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1.5" align="end" sideOffset={2}>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onAddTicket(swimlane.key);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <PlusIcon className="size-4" />
                Add Issue
              </button>
              <span className="flex items-center px-2 py-1 text-xs font-medium text-muted-foreground">
                Sort by
              </span>
              {(['order', 'priority', 'created', 'due'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onSortChange(swimlane.key, key);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
                    sortBy === key && 'bg-accent/50 font-medium',
                  )}
                >
                  {SORT_ICONS[key]}
                  {SORT_LABELS[key]}
                  {sortBy === key && <span className="ml-auto text-primary text-xs">&#10003;</span>}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {!collapsed && (
        <div
          ref={setNodeRef}
          className="flex-1 overflow-y-auto min-h-0"
        >
          <div className="flex flex-col gap-2 p-3">
            {sortedTickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                labelsById={labelsById}
                ticketsById={ticketsById}
                onOpen={onOpenTicket}
              />
            ))}
            {sortedTickets.length === 0 && (
              <div className="flex flex-col items-center gap-1 py-4 text-muted-foreground text-xs">
                <span>No tickets</span>
                <button
                  type="button"
                  onClick={() => onAddTicket(swimlane.key)}
                  className="text-primary hover:underline"
                >
                  + Add issue
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function sortTickets(tickets: Ticket[], sort: 'order' | 'priority' | 'created' | 'due'): Ticket[] {
  const arr = [...tickets];
  switch (sort) {
    case 'priority':
      return arr.sort((a, b) => a.priority - b.priority);
    case 'created':
      return arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case 'due':
      return arr.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });
    default:
      return arr.sort((a, b) => a.order - b.order);
  }
}
