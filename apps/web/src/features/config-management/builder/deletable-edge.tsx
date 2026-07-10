import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Edge with an always-visible delete button at its midpoint. Clicking the button
 * (or selecting the edge and pressing Delete/Backspace) removes the dependency.
 */
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={cn(
            'nodrag nopan pointer-events-auto absolute flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:border-destructive hover:bg-destructive hover:text-white hover:opacity-100',
            selected ? 'border-destructive text-destructive' : 'opacity-80',
          )}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onClick={(event) => {
            event.stopPropagation();
            setEdges((eds) => eds.filter((edge) => edge.id !== id));
          }}
          title="Delete connection"
          aria-label="Delete connection"
        >
          <XIcon className="size-3" />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
