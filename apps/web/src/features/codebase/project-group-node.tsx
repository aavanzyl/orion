import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PackageIcon, BlocksIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileGraphNode } from '@orion/models';

function ProjectGroupNodeComponent({ data, selected }: NodeProps) {
  const { name, projectType, fileCount } = data as unknown as FileGraphNode;
  const isApp = projectType === 'application';
  const Icon = isApp ? BlocksIcon : PackageIcon;
  const label = isApp ? 'App' : 'Lib';

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border-2 bg-card/90 shadow-sm transition-shadow',
        'w-[180px]',
        isApp
          ? 'border-violet-400/60'
          : 'border-amber-400/60',
        selected && 'ring-1 ring-ring shadow-md',
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!size-2 !-top-1 !border !border-muted-foreground/25 !bg-background"
      />
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
        <Icon className={cn('size-3.5 shrink-0', isApp ? 'text-violet-400' : 'text-amber-400')} />
        <span className="truncate text-xs font-semibold">{name}</span>
      </div>
      <div className="flex items-center justify-between px-3 pb-2">
        <span className={cn(
          'rounded px-1.5 py-px text-[0.55rem] font-medium uppercase',
          isApp
            ? 'bg-violet-500/10 text-violet-400'
            : 'bg-amber-500/10 text-amber-400',
        )}>
          {label}
        </span>
        <span className="text-[0.55rem] text-muted-foreground/60 tabular-nums">
          {fileCount ?? 0} files
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-2 !-bottom-1 !border !border-muted-foreground/25 !bg-background"
      />
    </div>
  );
}

export const ProjectGroupNode = memo(ProjectGroupNodeComponent);
