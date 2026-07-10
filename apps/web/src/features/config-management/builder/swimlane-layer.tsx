import { useViewport } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { UNASSIGNED_LANE, type Lane } from './builder-model';

/**
 * Renders the swimlane bands behind the nodes. It lives inside `<ReactFlow>` and
 * mirrors the viewport transform so the lanes pan and zoom with the canvas. A
 * low z-index keeps it above the dotted background but below the nodes/edges.
 */
export function SwimlaneLayer({ lanes }: { lanes: Lane[] }) {
  const { x, y, zoom } = useViewport();
  if (lanes.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}
      >
        {lanes.map((lane) => (
          <div
            key={lane.key}
            className={cn(
              'absolute rounded-xl border border-dashed border-border/60',
              lane.key === UNASSIGNED_LANE ? 'bg-muted/10' : lane.index % 2 === 0 ? 'bg-muted/30' : 'bg-muted/15',
            )}
            style={{ left: lane.x, top: lane.y, width: lane.width, height: lane.height }}
          >
            <span className="absolute left-3 top-2 rounded-full bg-primary/15 px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
              {lane.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
