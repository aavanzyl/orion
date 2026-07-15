import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { RouteIcon, FunctionSquareIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CallGraphNode as CallGraphNodeType } from '@orion/models';

function CallGraphNodeComponent({ data, selected }: NodeProps) {
  const { name, filePath, type, line } = data as unknown as CallGraphNodeType;
  const isEndpoint = type === 'endpoint';
  const Icon = isEndpoint ? RouteIcon : FunctionSquareIcon;
  const shortFile = filePath.split('/').slice(-2).join('/');
  const displayName = name.length > 32 ? name.slice(0, 30) + '…' : name;

  return (
    <div
      className={cn(
        'flex flex-col rounded border-2 bg-card shadow-sm w-[180px]',
        selected
          ? 'ring-1 ring-ring shadow-md border-primary/60'
          : 'hover:shadow-md',
        isEndpoint
          ? 'border-emerald-400 dark:border-emerald-300'
          : 'border-blue-400 dark:border-blue-300',
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!size-2 !-top-1 !border !border-muted-foreground/20 !bg-background"
      />
      <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5">
        <div
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded',
            isEndpoint
              ? 'bg-emerald-500/10 dark:bg-emerald-400/10'
              : 'bg-blue-500/10 dark:bg-blue-400/10',
          )}
        >
          <Icon className="size-2.5" />
        </div>
        <span className="truncate text-[0.6rem] font-mono font-medium leading-tight">
          {displayName}
        </span>
      </div>
      <div className="flex items-center justify-between px-2 pb-1.5">
        <span className="text-[0.5rem] text-muted-foreground truncate max-w-[110px]" title={filePath}>
          {shortFile}:{line}
        </span>
        <span
          className={cn(
            'rounded px-1 py-px text-[0.45rem] font-medium uppercase',
            isEndpoint
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
              : 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
          )}
        >
          {isEndpoint ? 'EP' : 'FN'}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-2 !-bottom-1 !border !border-muted-foreground/20 !bg-background"
      />
    </div>
  );
}

export const CallGraphNode = memo(CallGraphNodeComponent);
