import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Markdown } from '@/components/markdown';
import { cn } from '@/lib/utils';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  id?: string;
}

/** A markdown textarea with a Write/Preview toggle. */
export function MarkdownEditor({ value, onChange, placeholder, rows = 6, id }: MarkdownEditorProps) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 text-xs">
        <TabButton active={mode === 'write'} onClick={() => setMode('write')}>
          Write
        </TabButton>
        <TabButton active={mode === 'preview'} onClick={() => setMode('preview')}>
          Preview
        </TabButton>
      </div>
      {mode === 'write' ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="font-mono text-sm"
        />
      ) : (
        <div className="min-h-24 rounded-md border bg-muted/30 px-3 py-2">
          {value.trim() ? (
            <Markdown content={value} />
          ) : (
            <span className="text-sm text-muted-foreground">Nothing to preview.</span>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-1 font-medium transition-colors',
        active ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
