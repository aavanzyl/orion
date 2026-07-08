import { useEffect, useRef, useState } from 'react';
import { CornerDownLeftIcon, FolderIcon, Loader2Icon } from 'lucide-react';
import { api, type DirEntry } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface PathPickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/**
 * A path input with server-driven directory autocomplete. Because the board can
 * run on a remote host, the browser cannot open a native folder dialog — instead
 * the orchestrator lists directories (confined to a safe root) as the user types.
 */
export function PathPicker({ id, value, onChange, placeholder }: PathPickerProps) {
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
    <div className="relative">
      <Input
        id={id}
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
      />
      {open && (
        <div
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          onMouseDown={(e) => {
            // Keep focus in the input so blur doesn't close before the click.
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
            <span className="truncate">{dir || 'Browsing…'}</span>
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
