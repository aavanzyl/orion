import type { Ticket, TicketRelationKind } from '@orion/models';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const RELATION_KINDS: ReadonlyArray<{ value: TicketRelationKind; label: string }> = [
  { value: 'blocks', label: 'Blocking' },
  { value: 'blocked_by', label: 'Blocked by' },
  { value: 'related', label: 'Related to' },
];

const NONE = '__none__';

interface TicketSelectProps {
  tickets: Ticket[];
  value: string | undefined;
  onChange: (ticketId: string | undefined) => void;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
}

/** A dropdown for picking a ticket (used for parent and relationships). */
export function TicketSelect({
  tickets,
  value,
  onChange,
  placeholder = 'Select a ticket',
  allowNone = false,
  noneLabel = 'None',
  className,
}: TicketSelectProps) {
  return (
    <Select
      value={value ?? (allowNone ? NONE : undefined)}
      onValueChange={(v) => onChange(v === NONE ? undefined : v)}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {tickets.map((ticket) => (
          <SelectItem key={ticket.id} value={ticket.id}>
            {ticket.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function RelationKindSelect({
  value,
  onChange,
  className,
}: {
  value: TicketRelationKind;
  onChange: (value: TicketRelationKind) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as TicketRelationKind)}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RELATION_KINDS.map((k) => (
          <SelectItem key={k.value} value={k.value}>
            {k.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
