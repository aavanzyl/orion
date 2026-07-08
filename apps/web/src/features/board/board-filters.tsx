import { SearchIcon, XIcon } from 'lucide-react';
import type { Label as LabelModel, TicketPriority } from '@orion/models';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { PRIORITY_META } from './priority';

export interface BoardFilterState {
  search: string;
  priority: TicketPriority | 'all';
  labelIds: string[];
}

export const EMPTY_FILTERS: BoardFilterState = {
  search: '',
  priority: 'all',
  labelIds: [],
};

export function isFilterActive(f: BoardFilterState): boolean {
  return f.search.trim() !== '' || f.priority !== 'all' || f.labelIds.length > 0;
}

interface BoardFiltersProps {
  filters: BoardFilterState;
  labels: LabelModel[];
  onChange: (filters: BoardFilterState) => void;
}

export function BoardFilters({ filters, labels, onChange }: BoardFiltersProps) {
  const toggleLabel = (id: string) => {
    const next = filters.labelIds.includes(id)
      ? filters.labelIds.filter((l) => l !== id)
      : [...filters.labelIds, id];
    onChange({ ...filters, labelIds: next });
  };

  const activeCount = (filters.search.trim() ? 1 : 0) + (filters.priority !== 'all' ? 1 : 0) + filters.labelIds.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {activeCount > 0 && (
        <Badge variant="secondary" className="h-6 px-1.5 text-xs font-normal">
          {activeCount} filter{activeCount !== 1 ? 's' : ''}
        </Badge>
      )}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search tickets…"
          className="h-9 w-56 pl-8"
        />
      </div>

      <Select
        value={String(filters.priority)}
        onValueChange={(v) =>
          onChange({
            ...filters,
            priority: v === 'all' ? 'all' : (Number(v) as TicketPriority),
          })
        }
      >
        <SelectTrigger className="h-9 w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All priorities</SelectItem>
          {([1, 2, 3, 4, 0] as TicketPriority[]).map((p) => {
            const Icon = PRIORITY_META[p].icon;
            return (
              <SelectItem key={p} value={String(p)}>
                <Icon className={cn('size-4', PRIORITY_META[p].className)} />
                {PRIORITY_META[p].label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {labels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {labels.map((label) => {
            const active = filters.labelIds.includes(label.id);
            return (
              <button
                key={label.id}
                type="button"
                onClick={() => toggleLabel(label.id)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs transition-colors',
                  active
                    ? 'border-transparent text-white'
                    : 'text-muted-foreground hover:bg-muted',
                )}
                style={active ? { backgroundColor: label.color } : undefined}
              >
                {label.name}
              </button>
            );
          })}
        </div>
      )}

      {isFilterActive(filters) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          <XIcon data-icon="inline-start" />
          Clear
        </Button>
      )}
    </div>
  );
}
