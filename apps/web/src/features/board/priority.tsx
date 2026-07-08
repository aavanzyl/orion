import {
  MinusIcon,
  SignalHighIcon,
  SignalLowIcon,
  SignalMediumIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react';
import { TICKET_PRIORITIES, type TicketPriority } from '@orion/models';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface PriorityMeta {
  label: string;
  icon: LucideIcon;
  className: string;
}

export const PRIORITY_META: Record<TicketPriority, PriorityMeta> = {
  0: { label: 'No priority', icon: MinusIcon, className: 'text-muted-foreground' },
  1: { label: 'Urgent', icon: TriangleAlertIcon, className: 'text-orange-500' },
  2: { label: 'High', icon: SignalHighIcon, className: 'text-foreground' },
  3: { label: 'Medium', icon: SignalMediumIcon, className: 'text-foreground' },
  4: { label: 'Low', icon: SignalLowIcon, className: 'text-muted-foreground' },
};

export function PriorityIcon({ priority, className }: { priority: TicketPriority; className?: string }) {
  const meta = PRIORITY_META[priority];
  const Icon = meta.icon;
  return <Icon className={cn('size-4', meta.className, className)} aria-label={meta.label} />;
}

interface PrioritySelectProps {
  value: TicketPriority;
  onChange: (value: TicketPriority) => void;
  className?: string;
}

export function PrioritySelect({ value, onChange, className }: PrioritySelectProps) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v) as TicketPriority)}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TICKET_PRIORITIES.map((p) => {
          const Icon = PRIORITY_META[p.value].icon;
          return (
            <SelectItem key={p.value} value={String(p.value)}>
              <Icon className={cn('size-4', PRIORITY_META[p.value].className)} />
              {p.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
