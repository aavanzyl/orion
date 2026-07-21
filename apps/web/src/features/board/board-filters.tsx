import { useState } from 'react';
import { SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
  const [open, setOpen] = useState(false);

  const toggleLabel = (id: string) => {
    const next = filters.labelIds.includes(id)
      ? filters.labelIds.filter((l) => l !== id)
      : [...filters.labelIds, id];
    onChange({ ...filters, labelIds: next });
  };

  const filterActiveCount = (filters.priority !== 'all' ? 1 : 0) + filters.labelIds.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search tickets..."
          className="h-9 w-56 pl-8"
        />
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 relative max-lg:size-9 max-lg:px-0">
            <SlidersHorizontalIcon className="size-3.5 max-lg:mx-auto" />
            <span className="hidden lg:inline">Filters</span>
            {filterActiveCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 text-xs px-1 py-0 rounded-full max-lg:absolute max-lg:-right-1 max-lg:-top-1 max-lg:ml-0">
                {filterActiveCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start" sideOffset={4}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Priority</span>
              <Select
                value={String(filters.priority)}
                onValueChange={(v) =>
                  onChange({
                    ...filters,
                    priority: v === 'all' ? 'all' : (Number(v) as TicketPriority),
                  })
                }
              >
                <SelectTrigger className="h-8 w-full">
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
            </div>

            {labels.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Labels</span>
                <div className="flex flex-wrap gap-1">
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
              </div>
            )}

            {filterActiveCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange({ ...filters, priority: 'all', labelIds: [] });
                  setOpen(false);
                }}
                className="h-7"
              >
                <XIcon data-icon="inline-start" />
                Clear filters
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {isFilterActive(filters) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          <XIcon data-icon="inline-start" />
          Clear all
        </Button>
      )}
    </div>
  );
}
