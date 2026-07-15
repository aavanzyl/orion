import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  FileTextIcon,
  FileCodeIcon,
  FileJsonIcon,
  FileCogIcon,
  FileType2Icon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileGraphNode } from '@orion/models';

const EXTENSION_ICONS: Record<string, React.ElementType> = {
  ts: FileCodeIcon, tsx: FileCodeIcon, js: FileCodeIcon, jsx: FileCodeIcon,
  json: FileJsonIcon, yaml: FileCogIcon, yml: FileCogIcon,
  md: FileTextIcon, css: FileType2Icon, html: FileCodeIcon,
  py: FileCodeIcon, rs: FileCodeIcon, go: FileCodeIcon,
  sh: FileCogIcon, sql: FileCogIcon, proto: FileCogIcon,
  graphql: FileCogIcon, toml: FileCogIcon, env: FileCogIcon,
};

function FileNodeComponent({ data, selected }: NodeProps) {
  const { name, extension, chunkCount, importCount, importedByCount } =
    data as unknown as FileGraphNode;
  const connected = importCount > 0 || importedByCount > 0;
  const Icon = EXTENSION_ICONS[extension] ?? FileTextIcon;

  return (
    <div
      className={cn(
        'flex flex-col rounded border bg-card shadow-sm transition-shadow',
        'w-[140px]',
        selected
          ? 'ring-1 ring-ring shadow-md border-primary/60'
          : 'border-border hover:shadow-md',
      )}
    >
      {connected && (
        <Handle
          type="target"
          position={Position.Left}
          className="!size-2 !-left-1 !border !border-muted-foreground/25 !bg-background"
        />
      )}
      <div className="flex items-center gap-1 px-2 pt-1.5 pb-0.5">
        <Icon className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate text-[0.65rem] font-medium leading-tight">{name}</span>
      </div>
      <div className="flex items-center justify-between px-2 pb-1.5">
        <span className="rounded bg-muted/60 px-1 py-px text-[0.5rem] font-medium uppercase text-muted-foreground">
          {extension}
        </span>
        <span className="text-[0.5rem] text-muted-foreground/60 tabular-nums">
          {chunkCount}c
        </span>
      </div>
      {connected && (
        <Handle
          type="source"
          position={Position.Right}
          className="!size-2 !-right-1 !border !border-muted-foreground/25 !bg-background"
        />
      )}
    </div>
  );
}

export const FileNode = memo(FileNodeComponent);
