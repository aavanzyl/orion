import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CornerDownLeftIcon, FolderIcon, Loader2Icon, PlusIcon, XIcon } from 'lucide-react';
import { api, type DirEntry } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface MultiPathPickerProps {
  id?: string;
  paths: string[];
  onChange: (paths: string[]) => void;
  placeholder?: string;
}

function SinglePathPicker({
  value,
  onChange,
  placeholder,
  onRemove,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [dir, setDir] = useState('');
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .listDirectories(value)
        .then((res) => {
          if (cancelled) return;
          setEntries(res.entries);
          setDir(res.dir);
          setActive(-1);
        })
        .catch(() => {
          if (!cancelled) setEntries([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, open]);

  const select = (entry: DirEntry) => {
    onChange(`${entry.path}/`);
    setOpen(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, entries.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && active >= 0 && entries[active]) {
      e.preventDefault();
      select(entries[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative flex-1">
      <div className="flex gap-1">
        <Input
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          className="flex-1"
        />
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={onRemove}
          >
            <XIcon className="size-4" />
          </Button>
        )}
      </div>
      {open && (
        <div
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          onMouseDown={(e) => {
            e.preventDefault();
            if (blurTimer.current) clearTimeout(blurTimer.current);
          }}
        >
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            {loading ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <FolderIcon className="size-3" />
            )}
            <span className="truncate">{dir || 'Browsing...'}</span>
          </div>
          {entries.length === 0 && !loading ? (
            <div className="px-2 py-2 text-sm text-muted-foreground">No matching folders.</div>
          ) : (
            entries.map((entry, i) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => select(entry)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                  i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                )}
              >
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{entry.name}</span>
                {i === active && (
                  <CornerDownLeftIcon className="ml-auto size-3 text-muted-foreground" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function MultiPathPicker({ paths, onChange, placeholder }: MultiPathPickerProps) {
  const update = useCallback(
    (index: number, val: string) => {
      const next = [...paths];
      next[index] = val;
      onChange(next);
    },
    [paths, onChange],
  );

  const remove = useCallback(
    (index: number) => {
      onChange(paths.filter((_, i) => i !== index));
    },
    [paths, onChange],
  );

  const add = useCallback(() => {
    onChange([...paths, '']);
  }, [paths, onChange]);

  return (
    <div className="flex flex-col gap-2">
      {paths.map((p, i) => (
        <SinglePathPicker
          key={i}
          value={p}
          onChange={(val) => update(i, val)}
          placeholder={placeholder ?? `/path/to/folder-${i + 1}`}
          onRemove={paths.length > 1 ? () => remove(i) : undefined}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1 self-start"
        onClick={add}
      >
        <PlusIcon className="size-3.5" />
        Add folder
      </Button>
    </div>
  );
}
