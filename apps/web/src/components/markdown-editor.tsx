import { useRef, useState } from 'react';
import {
  BoldIcon,
  Code2Icon,
  CodeIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  HeadingIcon,
  MinusIcon,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Markdown } from '@/components/markdown';
import { cn } from '@/lib/utils';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  id?: string;
  className?: string;
}

function insertAtCursor(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder: string,
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end) || placeholder;
  const newValue =
    textarea.value.slice(0, start) + before + selected + after + textarea.value.slice(end);
  textarea.value = newValue;
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = start + before.length + selected.length;
  textarea.focus();
  return newValue;
}

const tools = [
  { label: 'Bold', icon: BoldIcon, before: '**', after: '**', placeholder: 'bold text' },
  { label: 'Italic', icon: ItalicIcon, before: '_', after: '_', placeholder: 'italic text' },
  { label: 'Heading', icon: HeadingIcon, before: '\n## ', after: '', placeholder: 'heading' },
  { label: 'Bullet list', icon: ListIcon, before: '\n- ', after: '', placeholder: 'list item' },
  { label: 'Numbered list', icon: ListOrderedIcon, before: '\n1. ', after: '', placeholder: 'list item' },
  { label: 'Link', icon: LinkIcon, before: '[', after: '](url)', placeholder: 'link text' },
  { label: 'Code', icon: CodeIcon, before: '`', after: '`', placeholder: 'code' },
  { label: 'Code block', icon: Code2Icon, before: '\n```\n', after: '\n```\n', placeholder: 'code block' },
  { label: 'Quote', icon: QuoteIcon, before: '\n> ', after: '', placeholder: 'quote' },
  { label: 'Horizontal rule', icon: MinusIcon, before: '\n\n---\n\n', after: '', placeholder: '' },
];

/** A markdown textarea with a formatting toolbar and Write/Preview toggle. */
export function MarkdownEditor({ value, onChange, placeholder, rows = 6, id, className }: MarkdownEditorProps) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const applyTool = (before: string, after: string, placeholder: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const newValue = insertAtCursor(textarea, before, after, placeholder);
    onChange(newValue);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-1">
        {mode === 'write' ? (
          <div className="flex items-center gap-0.5">
            {tools.map((tool) => (
              <button
                key={tool.label}
                type="button"
                onClick={() => applyTool(tool.before, tool.after, tool.placeholder)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title={tool.label}
              >
                <tool.icon className="size-3.5" />
              </button>
            ))}
          </div>
        ) : (
          <div />
        )}
        <div className="flex gap-1 text-xs">
          <TabButton active={mode === 'write'} onClick={() => setMode('write')}>
            Write
          </TabButton>
          <TabButton active={mode === 'preview'} onClick={() => setMode('preview')}>
            Preview
          </TabButton>
        </div>
      </div>
      {mode === 'write' ? (
        <Textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className={cn('font-mono text-sm !leading-[1.6]', className)}
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
