import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  SmoothStepEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FolderIcon, Loader2Icon, LayoutGridIcon } from 'lucide-react';
import type { DirSummary, FileGraph } from '@orion/models';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useProjects } from '@/features/projects/hooks';
import { FileNode } from './file-node';
import { ProjectGroupNode } from './project-group-node';

const nodeTypes = { file: FileNode, project_group: ProjectGroupNode };
const edgeTypes = { smoothstep: SmoothStepEdge };
const defaultEdgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: '#94a3b8' },
  style: { stroke: '#94a3b8', strokeWidth: 0.8, opacity: 0.4 },
  pathOptions: { borderRadius: 8 },
};

const EXTENSION_OPTIONS = [
  { value: '', label: 'All (default)' },
  { value: 'ts,tsx', label: '.ts/.tsx only' },
  { value: 'js,jsx', label: '.js/.jsx only' },
  { value: 'ts,tsx,js,jsx,py', label: 'TS/JS + Python' },
  { value: 'ts,tsx,js,jsx,go', label: 'TS/JS + Go' },
  { value: 'ts,tsx,js,jsx,rs', label: 'TS/JS + Rust' },
  { value: 'py', label: 'Python only' },
  { value: 'go', label: 'Go only' },
];

const LEGEND_ITEMS = [
  { color: 'border-violet-400 bg-violet-500/10', label: 'Application' },
  { color: 'border-amber-400 bg-amber-500/10', label: 'Library' },
  { color: 'border-border bg-card', label: 'File' },
];

function graphToFlow(graph: FileGraph): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((gn) => ({
      id: gn.path,
      type: gn.nodeType === 'project_group' ? 'project_group' : 'file',
      position: { x: gn.x ?? 40, y: gn.y ?? 30 },
      draggable: true,
      data: gn as unknown as Record<string, unknown>,
    })),
    edges: graph.edges.map((e, i) => ({
      id: `${e.source}→${e.target}_${i}`,
      source: e.source,
      target: e.target,
    })),
  };
}

function Legend() {
  return (
    <div className="absolute bottom-4 right-4 z-10 rounded-lg border bg-card/95 px-3 py-2 shadow-sm backdrop-blur-sm">
      <div className="flex flex-col gap-1">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-xs">
            <div className={`size-2.5 rounded border-2 ${item.color}`} />
            <span className="text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InnerGraph({ nodes: initNodes, edges: initEdges }: { nodes: Node[]; edges: Edge[] }) {
  const [nodes, , onNodesChange] = useNodesState(initNodes);
  const [edges, , onEdgesChange] = useEdgesState(initEdges);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      elevateNodesOnSelect={false}
      onlyRenderVisibleElements
      minZoom={0.05}
      maxZoom={2}
    >
      <Background color="#94a3b8" gap={16} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

function GraphCanvas({ projectId }: { projectId: string }) {
  const [graph, setGraph] = useState<FileGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirs, setDirs] = useState<DirSummary[]>([]);
  const [selectedDir, setSelectedDir] = useState('');
  const [selectedExt, setSelectedExt] = useState('');

  useEffect(() => {
    api.getProjectDirs(projectId).then(setDirs).catch(() => setDirs([]));
  }, [projectId]);

  const fetchGraph = useCallback(
    (dir: string, ext: string) => {
      let cancelled = false;
      setLoading(true);
      setError(null);
      api
        .getCodegenGraph(projectId, {
          dir: dir || undefined,
          extensions: ext || undefined,
        })
        .then((g) => {
          if (!cancelled) setGraph(g);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => { cancelled = true; };
    },
    [projectId],
  );

  useEffect(() => {
    setGraph(null);
    return fetchGraph(selectedDir, selectedExt);
  }, [fetchGraph, selectedDir, selectedExt, projectId]);

  const flow = useMemo(() => (graph ? graphToFlow(graph) : { nodes: [], edges: [] }), [graph]);
  const graphKey = `${projectId}_${selectedDir}_${selectedExt}_${flow.nodes.length}`;

  const sortedDirs = useMemo(
    () =>
      dirs
        .filter((d) => d.fileCount > 0)
        .sort((a, b) => {
          if (a.path === '.') return -1;
          if (b.path === '.') return 1;
          return a.path.localeCompare(b.path);
        }),
    [dirs],
  );

  const hasProjectNodes = graph?.nodes.some((n) => n.nodeType === 'project_group');

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-2.5">
        <FolderIcon className="size-3.5 text-muted-foreground shrink-0" />
        <Label className="text-xs text-muted-foreground shrink-0">Dir</Label>
        <Select value={selectedDir} onValueChange={setSelectedDir}>
          <SelectTrigger size="sm" className="w-48 text-xs">
            <SelectValue placeholder="All directories" />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            <SelectItem value="">All directories</SelectItem>
            {sortedDirs.map((d) => (
              <SelectItem key={d.path} value={d.path}>
                {d.path === '.' ? '(root)' : d.path}{' '}
                <span className="text-muted-foreground/60 ml-1">({d.fileCount})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label className="text-xs text-muted-foreground shrink-0 ml-2">Lang</Label>
        <Select value={selectedExt} onValueChange={setSelectedExt}>
          <SelectTrigger size="sm" className="w-36 text-xs">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            {EXTENSION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {loading && (
          <Loader2Icon className="size-3.5 animate-spin text-muted-foreground ml-2" />
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {flow.nodes.length} nodes · {flow.edges.length} edges
          {hasProjectNodes && ' · NX detected'}
        </span>
      </div>
      <div className="min-h-0 flex-1 relative">
        {!graph || graph.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center">
              {loading ? (
                <>
                  <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Analyzing project graph...</p>
                </>
              ) : (
                <>
                  <LayoutGridIcon className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No files found matching the current filters.
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div key={graphKey} className="h-full w-full">
            <InnerGraph nodes={flow.nodes} edges={flow.edges} />
            <Legend />
          </div>
        )}
      </div>
    </div>
  );
}

export function CodegenGraphPage() {
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState<string>('');

  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Project Structure Graph</h1>
          <p className="text-sm text-muted-foreground">
            NX project-aware dependency graph — apps, libraries, and file import relationships.
          </p>
        </div>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>
      <main className="min-h-0 flex-1 relative">
        {projectId ? (
          <GraphCanvas projectId={projectId} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <LayoutGridIcon className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Select a project to view its project structure graph.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
