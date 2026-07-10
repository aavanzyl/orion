import type { WorkflowNodeType } from '@orion/models';
import { cn } from '@/lib/utils';
import { NODE_TYPES } from './builder-model';
import { NODE_VISUALS } from './workflow-node';

/** The MIME type used to carry a node type through an HTML5 drag. */
export const NODE_DND_MIME = 'application/orion-node';

type VisibleNodeType = typeof NODE_TYPES[number];

const DESCRIPTIONS: Record<VisibleNodeType, string> = {
  agent: 'Run an AI agent',
  shell: 'Run a shell script',
  approval: 'Pause for human approval',
  scm: 'Source-control action',
  message: 'Notify or comment',
  condition: 'Branch on a condition',
  http: 'Make an HTTP request',
  graphql: 'Run a GraphQL operation',
};

/**
 * Left-hand palette of node types. Each item can be dragged onto a swimlane or
 * clicked to drop a node onto the canvas.
 */
export function NodePalette({ onAdd }: { onAdd: (type: WorkflowNodeType) => void }) {
  return (
    <aside className="flex w-48 shrink-0 flex-col border-r bg-card">
      <div className="border-b px-3 py-3">
        <h2 className="text-sm font-semibold">Nodes</h2>
        <p className="text-[11px] leading-tight text-muted-foreground">
          Drag onto a lane or click to add.
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {NODE_TYPES.map((type) => {
          const visual = NODE_VISUALS[type];
          const Icon = visual.icon;
          return (
            <button
              key={type}
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(NODE_DND_MIME, type);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => onAdd(type)}
              className={cn(
                'group flex cursor-grab items-start gap-2 rounded-lg border-2 p-2 text-left transition-shadow hover:shadow-sm active:cursor-grabbing',
                visual.card,
              )}
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-md',
                  visual.badge,
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{visual.label}</span>
                <span className="block text-[11px] leading-tight text-muted-foreground">
                  {DESCRIPTIONS[type]}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
