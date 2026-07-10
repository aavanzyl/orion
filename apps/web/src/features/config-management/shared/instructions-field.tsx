import { useId, useState } from 'react';
import { FilePenLineIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FieldLabel } from './node-properties/fields';

export interface InstructionsFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Known `.orion/` command file paths used to autocomplete the path input. */
  commandFiles?: string[];
  /** Opens the markdown editor for the given path. When omitted, the button is hidden. */
  onEditFile?: (path: string) => void;
  /** Render a compact label above the control. Defaults to true. */
  showLabel?: boolean;
}

/**
 * Shared editor for an agent node's `instructions`. Supports both a markdown
 * command-file path (with autocomplete + an "Edit file" affordance) and inline
 * multi-line instructions, and is used identically by the config editor and the
 * visual builder so the two stay at parity.
 */
export function InstructionsField({
  value,
  onChange,
  commandFiles = [],
  onEditFile,
  showLabel = true,
}: InstructionsFieldProps) {
  const listId = useId();
  const looksInline = value.includes('\n');
  const [inline, setInline] = useState(looksInline);
  const isInline = inline || looksInline;
  const trimmed = value.trim();
  const canEditFile = Boolean(trimmed) && !value.includes('\n');

  return (
    <div className="flex flex-col gap-1.5">
      {showLabel && (
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>Instructions</FieldLabel>
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setInline((prev) => !prev)}
          >
            {isInline ? 'Use a file path' : 'Write inline'}
          </button>
        </div>
      )}
      {isInline ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Inline instructions… supports $VARIABLE and {{ nodes.<id>.<path> }} substitution."
          spellCheck={false}
          className="min-h-24 text-sm"
        />
      ) : (
        <div className="flex items-center gap-2">
          <Input
            list={listId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="instructions/implement.md"
            spellCheck={false}
            className="font-mono text-sm"
          />
          <datalist id={listId}>
            {commandFiles.map((file) => (
              <option key={file} value={file} />
            ))}
          </datalist>
          {onEditFile && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canEditFile}
              onClick={() => onEditFile(trimmed)}
              aria-label="Edit instructions file"
              title="Edit this markdown file"
            >
              <FilePenLineIcon className="size-3.5" /> Edit file
            </Button>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        A markdown command-file path relative to <code>.orion/</code> (e.g.{' '}
        <code>instructions/implement.md</code>) or inline text. Defaults to{' '}
        <code>instructions/&lt;id&gt;.md</code>. Supports $VARIABLE substitution.
      </p>
    </div>
  );
}
