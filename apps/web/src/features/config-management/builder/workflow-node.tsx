import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  BrainIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  GlobeIcon,
  HandIcon,
  MessageSquareIcon,
  NetworkIcon,
  SettingsIcon,
  type LucideIcon,
} from 'lucide-react';
import type { WorkflowNodeType } from '@orion/models';
import { cn } from '@/lib/utils';
import { nodeSummary, NODE_TYPES, type BuilderNode } from './builder-model';

interface TypeVisual {
  label: string;
  icon: LucideIcon;
  /** Tailwind classes for the node card accent. */
  card: string;
  badge: string;
}

type VisibleNodeType = typeof NODE_TYPES[number];

export const NODE_VISUALS: Record<VisibleNodeType, TypeVisual> = {
  agent: {
    label: 'Agent',
    icon: BrainIcon,
    card: 'border-purple-400/60 bg-purple-50 dark:border-purple-500/40 dark:bg-purple-950/40',
    badge: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
  },
  shell: {
    label: 'Shell',
    icon: SettingsIcon,
    card: 'border-sky-400/60 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-950/40',
    badge: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  },
  approval: {
    label: 'Approval',
    icon: HandIcon,
    card: 'border-amber-400/60 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/40',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  scm: {
    label: 'SCM',
    icon: GitPullRequestIcon,
    card: 'border-emerald-400/60 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-950/40',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  message: {
    label: 'Message',
    icon: MessageSquareIcon,
    card: 'border-rose-400/60 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-950/40',
    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  },
  condition: {
    label: 'Condition',
    icon: GitBranchIcon,
    card: 'border-indigo-400/60 bg-indigo-50 dark:border-indigo-500/40 dark:bg-indigo-950/40',
    badge: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  },
  http: {
    label: 'HTTP',
    icon: GlobeIcon,
    card: 'border-orange-400/60 bg-orange-50 dark:border-orange-500/40 dark:bg-orange-950/40',
    badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  },
  graphql: {
    label: 'GraphQL',
    icon: NetworkIcon,
    card: 'border-pink-400/60 bg-pink-50 dark:border-pink-500/40 dark:bg-pink-950/40',
    badge: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
  },
};

function getVisual(type: WorkflowNodeType): TypeVisual {
  return NODE_VISUALS[type as keyof typeof NODE_VISUALS] ?? NODE_VISUALS.shell;
}

function WorkflowNodeComponent({ data, selected }: NodeProps<BuilderNode>) {
  const visual = getVisual(data.type);
  const Icon = visual.icon;
  return (
    <div
      className={cn(
        'w-52 rounded-lg border-2 px-3 py-2 shadow-sm transition-shadow',
        visual.card,
        selected && 'ring-2 ring-ring ring-offset-1',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-4 !-left-2 !border-2 !border-background !bg-muted-foreground transition-colors hover:!bg-primary"
        title="Drag a connection here (input)"
      />
      <div className="flex items-center gap-2">
        <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md', visual.badge)}>
          <Icon className="size-3.5" />
        </span>
        <span className="truncate text-sm font-semibold text-foreground">
          {data.nodeId || '(unnamed)'}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-0.5">
          {visual.label}
        </span>
        <span className="truncate text-xs text-muted-foreground">{nodeSummary(data)}</span>
      </div>
      {data.swimlane && (
        <div className="mt-1 truncate text-[10px] text-muted-foreground">→ {data.swimlane}</div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!size-4 !-right-2 !border-2 !border-background !bg-primary/80 transition-transform hover:!scale-125 hover:!bg-primary"
        title="Drag from here to connect (output)"
      />
    </div>
  );
}

export const WorkflowNode = memo(WorkflowNodeComponent);
