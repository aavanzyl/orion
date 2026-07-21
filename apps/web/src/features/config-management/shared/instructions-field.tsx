import { useId, useState } from 'react';
import { FilePenLineIcon, InfoIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { FieldLabel } from './node-properties/fields';
import { MarkdownEditor } from '@/components/markdown-editor';
import { CreateInstructionsAiModal } from './create-instructions-ai-modal';

export interface InstructionsFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Known `.orion/` command file paths used to autocomplete the path input. */
  commandFiles?: string[];
  /** Opens the markdown editor for the given path. When omitted, the button is hidden. */
  onEditFile?: (path: string) => void;
  /** Render a compact label above the control. Defaults to true. */
  showLabel?: boolean;
  /** The node's id label, shown as context in the AI modal. */
  nodeId?: string;
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
  nodeId,
}: InstructionsFieldProps) {
  const listId = useId();
  const trimmed = value.trim();

  const looksLikeFilePath =
    !value.includes('\n') &&
    (trimmed.startsWith('instructions/') ||
      trimmed.startsWith('./') ||
      trimmed.startsWith('../') ||
      trimmed.endsWith('.md'));
  const looksInline = value.includes('\n') || (trimmed.length > 0 && !looksLikeFilePath);
  const [inline, setInline] = useState(looksInline);
  const isInline = inline || looksInline;
  const canEditFile = Boolean(trimmed) && looksLikeFilePath;
  const [aiModalOpen, setAiModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      {showLabel && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <FieldLabel>Instructions</FieldLabel>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground cursor-help">
                  <InfoIcon className="size-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" align="start" className="max-w-72 text-xs">
                <p className="font-medium mb-1">Available variables:</p>
                <ul className="space-y-0.5">
                  <li><code className="text-[11px]">$ARGUMENTS</code> — ticket title + description</li>
                  <li><code className="text-[11px]">$TICKET_TITLE</code> — ticket title</li>
                  <li><code className="text-[11px]">$REPOSITORY</code> — project name</li>
                  <li><code className="text-[11px]">$REPOSITORIES</code> — all repos</li>
                  <li><code className="text-[11px]">$BRANCH</code> — run branch</li>
                  <li><code className="text-[11px]">$BASE_BRANCH</code> — default branch</li>
                  <li><code className="text-[11px]">$WORKFLOW_ID</code> — run ID</li>
                </ul>
                <p className="font-medium mt-1.5 mb-1">Node references:</p>
                <p className="text-[11px]"><code>{'{{ nodes.<id>.<path> }}'}</code> — upstream node output</p>
              </TooltipContent>
            </Tooltip>
            <button
              type="button"
              className="text-muted-foreground hover:text-violet-400 transition-colors"
              onClick={() => setAiModalOpen(true)}
              title="Write instructions with AI"
            >
              <SparklesIcon className="size-3" />
            </button>
          </div>
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
        <MarkdownEditor
          value={value}
          onChange={onChange}
          placeholder="Inline instructions… supports $VARIABLE and {{ nodes.<id>.<path> }} substitution."
          rows={6}
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
        <code>instructions/&lt;id&gt;.md</code>.
      </p>
      <CreateInstructionsAiModal
        open={aiModalOpen}
        onOpenChange={setAiModalOpen}
        onApply={(instructions) => onChange(instructions)}
        nodeId={nodeId}
      />
    </div>
  );
}
