import { useEffect, useRef, useState } from 'react';
import { CheckIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react';
import type { Label as LabelModel } from '@orion/models';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const PALETTE = [
  '#6366f1',
  '#ec4899',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ef4444',
  '#64748b',
];

export function LabelBadge({
  label,
  onRemove,
  className,
}: {
  label: LabelModel;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn('gap-1.5', className)}>
      <span className="size-2 rounded-full" style={{ backgroundColor: label.color }} />
      {label.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 opacity-60 hover:opacity-100"
          aria-label={`Remove ${label.name}`}
        >
          <XIcon className="size-3" />
        </button>
      )}
    </Badge>
  );
}

interface LabelPickerProps {
  labels: LabelModel[];
  selectedIds: string[];
  onToggle: (labelId: string) => void;
  onCreate: (name: string, color: string) => Promise<void>;
}

export function LabelPicker({ labels, selectedIds, onToggle, onCreate }: LabelPickerProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedLabels = labels.filter((l) => selectedIds.includes(l.id));

  const filtered = search.trim()
    ? labels.filter((l) => l.name.toLowerCase().includes(search.trim().toLowerCase()))
    : labels;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate(name.trim(), color);
      setName('');
      setColor(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      {selectedLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedLabels.map((label) => (
            <LabelBadge
              key={label.id}
              label={label}
              onRemove={() => onToggle(label.id)}
            />
          ))}
        </div>
      )}

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          placeholder="Search labels…"
          className="h-8 pl-7"
        />
        {dropdownOpen && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-md border bg-popover p-1 shadow-md">
            {filtered.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                No labels found.
              </div>
            ) : (
              filtered.map((label) => {
                const selected = selectedIds.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => onToggle(label.id)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                    <span className="flex-1 truncate text-left">{label.name}</span>
                    {selected && <CheckIcon className="size-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {creating ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="size-8 cursor-pointer rounded border bg-transparent"
            aria-label="Label color"
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Label name"
            className="h-8"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void create();
              }
            }}
          />
          <Button type="button" size="sm" onClick={create} disabled={busy || !name.trim()}>
            Add
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-fit"
          onClick={() => setCreating(true)}
        >
          <PlusIcon data-icon="inline-start" />
          New label
        </Button>
      )}
    </div>
  );
}
