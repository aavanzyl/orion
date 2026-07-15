import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  SmoothStepEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowRightLeftIcon,
  BarChart3Icon,
  InfoIcon,
  Loader2Icon,
  NetworkIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
} from 'lucide-react';
import type {
  GodNode,
  GraphNode as GraphNodeType,
  GraphPath,
  GraphQueryResult,
  GraphStats,
  KnowledgeGraph,
} from '@orion/models';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useProjects } from '@/features/projects/hooks';

const COMMUNITY_COLORS = [
  { border: 'border-blue-400 dark:border-blue-300', bg: 'bg-blue-500/10 dark:bg-blue-400/10', badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-300' },
  { border: 'border-red-400 dark:border-red-300', bg: 'bg-red-500/10 dark:bg-red-400/10', badge: 'bg-red-500/10 text-red-600 dark:text-red-300' },
  { border: 'border-emerald-400 dark:border-emerald-300', bg: 'bg-emerald-500/10 dark:bg-emerald-400/10', badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' },
  { border: 'border-amber-400 dark:border-amber-300', bg: 'bg-amber-500/10 dark:bg-amber-400/10', badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-300' },
  { border: 'border-violet-400 dark:border-violet-300', bg: 'bg-violet-500/10 dark:bg-violet-400/10', badge: 'bg-violet-500/10 text-violet-600 dark:text-violet-300' },
  { border: 'border-pink-400 dark:border-pink-300', bg: 'bg-pink-500/10 dark:bg-pink-400/10', badge: 'bg-pink-500/10 text-pink-600 dark:text-pink-300' },
  { border: 'border-cyan-400 dark:border-cyan-300', bg: 'bg-cyan-500/10 dark:bg-cyan-400/10', badge: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-300' },
  { border: 'border-orange-400 dark:border-orange-300', bg: 'bg-orange-500/10 dark:bg-orange-400/10', badge: 'bg-orange-500/10 text-orange-600 dark:text-orange-300' },
  { border: 'border-lime-400 dark:border-lime-300', bg: 'bg-lime-500/10 dark:bg-lime-400/10', badge: 'bg-lime-500/10 text-lime-600 dark:text-lime-300' },
  { border: 'border-indigo-400 dark:border-indigo-300', bg: 'bg-indigo-500/10 dark:bg-indigo-400/10', badge: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' },
];

const NODE_KIND_LABELS: Record<string, string> = {
  code: 'Code',
  document: 'Doc',
  rationale: 'Rationale',
  concept: 'Concept',
  package: 'Package',
};

const RELATION_FILTERS = [
  { value: '', label: 'All relations' },
  { value: 'calls', label: 'Calls' },
  { value: 'imports', label: 'Imports' },
  { value: 'inherits', label: 'Inherits' },
  { value: 'implements', label: 'Implements' },
  { value: 'references', label: 'References' },
  { value: 'contains', label: 'Contains' },
  { value: 'depends_on', label: 'Depends on' },
  { value: 'uses', label: 'Uses' },
];

const NODE_KIND_FILTERS = [
  { value: '', label: 'All kinds' },
  { value: 'code', label: 'Code' },
  { value: 'document', label: 'Document' },
  { value: 'rationale', label: 'Rationale' },
  { value: 'concept', label: 'Concept' },
  { value: 'package', label: 'Package' },
];

const KnowledgeNode = memo(function KnowledgeNode({ data, selected }: NodeProps) {
  const { label, fileType, community, degree, sourceFile, communityName } =
    data as unknown as GraphNodeType;
  const colorIndex = community != null ? community % COMMUNITY_COLORS.length : 0;
  const colors = COMMUNITY_COLORS[colorIndex];
  const minW = 140;
  const maxW = 220;
  const w = Math.min(maxW, minW + (degree ?? 0) * 6);
  const displayLabel = (label ?? '').length > 28 ? (label ?? '').slice(0, 26) + '\u2026' : (label ?? '');
  const shortFile = (sourceFile ?? '').split('/').slice(-2).join('/');
  const kindLabel = NODE_KIND_LABELS[fileType] ?? (fileType ?? '');

  return (
    <div
      className={cn(
        'flex flex-col rounded border-2 bg-card shadow-sm transition-shadow',
        selected
          ? 'ring-1 ring-ring shadow-md border-primary/60'
          : 'hover:shadow-md',
        colors.border,
      )}
      style={{ width: w }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!size-2 !-top-1 !border !border-muted-foreground/20 !bg-background"
      />
      <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5">
        <div className={cn('flex size-4 shrink-0 items-center justify-center rounded', colors.bg)}>
          <NetworkIcon className="size-2.5" />
        </div>
        <span className="truncate text-[0.6rem] font-mono font-medium leading-tight">
          {displayLabel}
        </span>
      </div>
      <div className="flex items-center justify-between px-2 pb-1.5">
        <span className="text-[0.5rem] text-muted-foreground truncate max-w-[100px]" title={sourceFile}>
          {shortFile}
        </span>
        <span className={cn('rounded px-1 py-px text-[0.45rem] font-medium uppercase', colors.badge)}>
          {kindLabel}
        </span>
      </div>
      {communityName && (
        <div className="px-2 pb-1.5">
          <span className="text-[0.45rem] text-muted-foreground truncate block" title={communityName}>
            {communityName}
          </span>
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-2 !-bottom-1 !border !border-muted-foreground/20 !bg-background"
      />
    </div>
  );
});

const nodeTypes = { knowledge: KnowledgeNode };
const edgeTypes = { smoothstep: SmoothStepEdge };
const defaultEdgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: '#94a3b8' },
  style: { stroke: '#94a3b8', strokeWidth: 0.8, opacity: 0.4 },
  pathOptions: { borderRadius: 8 },
};

function CommunityLegend({ communities }: { communities: string[] }) {
  return (
    <div className="absolute bottom-4 right-4 z-10 rounded-lg border bg-card/95 px-3 py-2 shadow-sm backdrop-blur-sm">
      <div className="flex flex-col gap-1">
        <span className="text-[0.6rem] font-semibold text-muted-foreground mb-0.5">Communities</span>
        {communities.map((name, i) => {
          const colors = COMMUNITY_COLORS[i % COMMUNITY_COLORS.length];
          return (
            <div key={name} className="flex items-center gap-2 text-xs">
              <div className={cn('size-2.5 rounded border-2', colors.border)} />
              <span className="text-muted-foreground truncate max-w-[120px]">{name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function graphToFlow(
  graph: KnowledgeGraph,
  relFilter: string,
  kindFilter: string,
): { nodes: Node[]; edges: Edge[] } {
  const filteredEdges = graph.edges.filter((e) => {
    if (relFilter && e.relation !== relFilter) return false;
    if (kindFilter) {
      const sourceNode = graph.nodes.find((n) => n.id === e.source);
      const targetNode = graph.nodes.find((n) => n.id === e.target);
      if (sourceNode?.fileType !== kindFilter && targetNode?.fileType !== kindFilter) return false;
    }
    return true;
  });

  const connectedIds = new Set<string>();
  for (const e of filteredEdges) {
    connectedIds.add(e.source);
    connectedIds.add(e.target);
  }

  const filteredNodes = graph.nodes.filter((n) => connectedIds.has(n.id));

  return {
    nodes: filteredNodes.map((gn) => ({
      id: gn.id,
      type: 'knowledge',
      position: { x: 40, y: 30 },
      draggable: true,
      data: gn as unknown as Record<string, unknown>,
    })),
    edges: filteredEdges.map((e, i) => ({
      id: `${e.source}\u2192${e.target}_${i}`,
      source: e.source,
      target: e.target,
      label: e.relation,
      labelStyle: { fontSize: 8, fill: '#94a3b8', fontWeight: 400 },
      labelBgStyle: { fill: 'transparent' },
      style: e.confidence === 'INFERRED'
        ? { stroke: '#94a3b8', strokeWidth: 0.5, opacity: 0.25, strokeDasharray: '4 2' }
        : e.confidence === 'AMBIGUOUS'
          ? { stroke: '#f59e0b', strokeWidth: 0.6, opacity: 0.5 }
          : { stroke: '#94a3b8', strokeWidth: 0.8, opacity: 0.4 },
    })),
  };
}

function InnerGraph({ graph, relFilter, kindFilter }: { graph: KnowledgeGraph; relFilter: string; kindFilter: string }) {
  const { nodes: initNodes, edges: initEdges } = useMemo(
    () => graphToFlow(graph, relFilter, kindFilter),
    [graph, relFilter, kindFilter],
  );
  const [nodes, , onNodesChange] = useNodesState(initNodes);
  const [edges, , onEdgesChange] = useEdgesState(initEdges);

  const communities = useMemo(() => {
    const seen = new Map<number, string>();
    for (const n of graph.nodes) {
      if (n.community != null && n.communityName && !seen.has(n.community)) {
        seen.set(n.community, n.communityName);
      }
    }
    return Array.from(seen.entries())
      .sort(([a], [b]) => a - b)
      .map(([, name]) => name);
  }, [graph.nodes]);

  return (
    <div className="h-full w-full relative">
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
      <CommunityLegend communities={communities} />
    </div>
  );
}

function GraphVizTab({ projectId }: { projectId: string }) {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relFilter, setRelFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');

  const fetchGraph = useCallback(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getKnowledgeGraph(projectId)
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
  }, [projectId]);

  useEffect(() => {
    setGraph(null);
    return fetchGraph();
  }, [fetchGraph]);

  const buildGraph = async () => {
    setBuilding(true);
    setError(null);
    try {
      const g = await api.buildKnowledgeGraph(projectId);
      setGraph(g);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  const filteredCount = useMemo(() => {
    if (!graph) return { nodes: 0, edges: 0 };
    const { nodes, edges } = graphToFlow(graph, relFilter, kindFilter);
    return { nodes: nodes.length, edges: edges.length };
  }, [graph, relFilter, kindFilter]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-2.5">
        <Label className="text-xs text-muted-foreground shrink-0">Relation</Label>
        <Select value={relFilter} onValueChange={setRelFilter}>
          <SelectTrigger size="sm" className="w-36 text-xs">
            <SelectValue placeholder="All relations" />
          </SelectTrigger>
          <SelectContent>
            {RELATION_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label className="text-xs text-muted-foreground shrink-0 ml-2">Kind</Label>
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger size="sm" className="w-32 text-xs">
            <SelectValue placeholder="All kinds" />
          </SelectTrigger>
          <SelectContent>
            {NODE_KIND_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={buildGraph} disabled={building}>
          <PlayIcon className={cn('size-3.5', building && 'animate-spin')} />
          {building ? 'Building\u2026' : 'Build Graph'}
        </Button>
        {(loading || building) && (
          <Loader2Icon className="size-3.5 animate-spin text-muted-foreground ml-2" />
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {graph ? `${graph.nodes.length} nodes \u00b7 ${graph.edges.length} edges` : ''}
          {relFilter || kindFilter ? ` \u00b7 filtered: ${filteredCount.nodes} nodes \u00b7 ${filteredCount.edges} edges` : ''}
        </span>
      </div>
      <div className="min-h-0 flex-1 relative">
        {error ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading knowledge graph\u2026</p>
            </div>
          </div>
        ) : !graph || graph.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <NetworkIcon className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No knowledge graph built yet. Click "Build Graph" to analyze the codebase.
              </p>
            </div>
          </div>
        ) : (
          <InnerGraph key={`${projectId}_${relFilter}_${kindFilter}_${graph.nodes.length}`} graph={graph} relFilter={relFilter} kindFilter={kindFilter} />
        )}
      </div>
    </div>
  );
}

function QueryExplorerTab({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState<GraphQueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);

  const [sourceNode, setSourceNode] = useState('');
  const [targetNode, setTargetNode] = useState('');
  const [pathResult, setPathResult] = useState<GraphPath | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [pathing, setPathing] = useState(false);

  const [explainLabel, setExplainLabel] = useState('');
  const [explainResult, setExplainResult] = useState<GraphNodeType | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);

  const [godNodes, setGodNodes] = useState<GodNode[]>([]);
  const [godLoading, setGodLoading] = useState(false);

  const [stats, setStats] = useState<GraphStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const handleQuery = async () => {
    if (!projectId || !query.trim()) return;
    setQuerying(true);
    setQueryError(null);
    try {
      const r = await api.queryKnowledgeGraph(projectId, query.trim());
      setQueryResult(r);
    } catch (e) {
      setQueryError((e as Error).message);
    } finally {
      setQuerying(false);
    }
  };

  const handleFindPath = async () => {
    if (!projectId || !sourceNode.trim() || !targetNode.trim()) return;
    setPathing(true);
    setPathError(null);
    try {
      const r = await api.findKnowledgeGraphPath(projectId, sourceNode.trim(), targetNode.trim());
      setPathResult(r);
    } catch (e) {
      setPathError((e as Error).message);
    } finally {
      setPathing(false);
    }
  };

  const handleExplain = async () => {
    if (!projectId || !explainLabel.trim()) return;
    setExplaining(true);
    setExplainError(null);
    try {
      const r = await api.explainKnowledgeGraphNode(projectId, explainLabel.trim());
      setExplainResult(r);
    } catch (e) {
      setExplainError((e as Error).message);
    } finally {
      setExplaining(false);
    }
  };

  const fetchGodNodes = useCallback(async () => {
    if (!projectId) return;
    setGodLoading(true);
    try {
      const r = await api.getGodNodes(projectId, 10);
      setGodNodes(r);
    } catch {
      setGodNodes([]);
    } finally {
      setGodLoading(false);
    }
  }, [projectId]);

  const fetchStats = useCallback(async () => {
    if (!projectId) return;
    setStatsLoading(true);
    try {
      const r = await api.getGraphStats(projectId);
      setStats(r);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchGodNodes();
    fetchStats();
  }, [fetchGodNodes, fetchStats]);

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-6">
        {/* Natural Language Query */}
        <Card className="col-span-full p-4">
          <div className="flex items-center gap-2 mb-3">
            <SearchIcon className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Natural Language Query</span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. What modules depend on the auth handler?"
              onKeyDown={(e) => { if (e.key === 'Enter') handleQuery(); }}
            />
            <Button size="sm" onClick={handleQuery} disabled={querying || !query.trim()}>
              {querying ? <Loader2Icon className="size-3.5 animate-spin" /> : <SearchIcon className="size-3.5" />}
              Query
            </Button>
          </div>
          {queryError && <p className="text-xs text-destructive mt-2">{queryError}</p>}
          {queryResult && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{queryResult.nodes.length} nodes \u00b7 {queryResult.edges.length} edges</span>
                <Badge variant="secondary">{queryResult.traversalType}</Badge>
                <span>depth {queryResult.depth}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {queryResult.nodes.map((n) => (
                  <Badge key={n.id} variant="outline" className="text-xs">
                    {n.label}
                    <span className="ml-1 text-muted-foreground/60">({NODE_KIND_LABELS[n.fileType] ?? n.fileType})</span>
                  </Badge>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                {queryResult.edges.map((e, i) => (
                  <div key={i}>
                    {e.source} \u2192 {e.target}
                    <span className="ml-1 text-muted-foreground/60">[{e.relation}]</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Path Finder */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <ArrowRightLeftIcon className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Path Finder</span>
          </div>
          <div className="flex flex-col gap-2">
            <Input
              value={sourceNode}
              onChange={(e) => setSourceNode(e.target.value)}
              placeholder="Source node label"
              className="text-xs"
            />
            <Input
              value={targetNode}
              onChange={(e) => setTargetNode(e.target.value)}
              placeholder="Target node label"
              className="text-xs"
            />
            <Button size="sm" onClick={handleFindPath} disabled={pathing || !sourceNode.trim() || !targetNode.trim()}>
              {pathing ? <Loader2Icon className="size-3.5 animate-spin" /> : <ArrowRightLeftIcon className="size-3.5" />}
              Find Path
            </Button>
          </div>
          {pathError && <p className="text-xs text-destructive mt-2">{pathError}</p>}
          {pathResult && (
            <div className="mt-3 space-y-1">
              <p className="text-xs text-muted-foreground">
                {pathResult.hops} hops from {pathResult.source} to {pathResult.target}
              </p>
              <div className="flex flex-wrap items-center gap-1 text-xs">
                {pathResult.path.nodes.map((n, i, arr) => (
                  <span key={i} className="flex items-center gap-1">
                    <Badge variant="outline" className="text-xs">{n}</Badge>
                    {i < arr.length - 1 && <span className="text-muted-foreground">\u2192</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Node Explainer */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <InfoIcon className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Node Explainer</span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={explainLabel}
              onChange={(e) => setExplainLabel(e.target.value)}
              placeholder="Node label to explain"
              className="text-xs"
              onKeyDown={(e) => { if (e.key === 'Enter') handleExplain(); }}
            />
            <Button size="sm" onClick={handleExplain} disabled={explaining || !explainLabel.trim()}>
              {explaining ? <Loader2Icon className="size-3.5 animate-spin" /> : <SearchIcon className="size-3.5" />}
              Explain
            </Button>
          </div>
          {explainError && <p className="text-xs text-destructive mt-2">{explainError}</p>}
          {explainResult && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge>{NODE_KIND_LABELS[explainResult.fileType] ?? explainResult.fileType}</Badge>
                {explainResult.communityName && (
                  <Badge variant="secondary">{explainResult.communityName}</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>ID: {explainResult.id}</p>
                <p>Source: {explainResult.sourceFile}</p>
                <p>Degree: {explainResult.degree ?? 0}</p>
              </div>
              {explainResult.metadata && (
                <pre className="text-xs text-muted-foreground bg-muted/50 rounded p-2 max-h-32 overflow-auto">
                  {JSON.stringify(explainResult.metadata, null, 2)}
                </pre>
              )}
            </div>
          )}
        </Card>

        {/* God Nodes */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <SparklesIcon className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">God Nodes</span>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchGodNodes} disabled={godLoading}>
              <RefreshCwIcon className={cn('size-3.5', godLoading && 'animate-spin')} />
            </Button>
          </div>
          {godLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : godNodes.length > 0 ? (
            <div className="space-y-1.5">
              {godNodes.map((gn) => (
                <div key={gn.nodeId} className="flex items-center justify-between rounded border px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <Badge variant="secondary" className="text-xs shrink-0">{gn.degree}</Badge>
                    <span className="truncate">{gn.label}</span>
                  </div>
                  <span className="text-muted-foreground/60 shrink-0 ml-2">
                    {NODE_KIND_LABELS[gn.fileType] ?? gn.fileType}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No god nodes available.</p>
          )}
        </Card>

        {/* Stats */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3Icon className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Graph Stats</span>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchStats} disabled={statsLoading}>
              <RefreshCwIcon className={cn('size-3.5', statsLoading && 'animate-spin')} />
            </Button>
          </div>
          {statsLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          ) : stats ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nodes</span>
                <span className="font-mono">{stats.nodeCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Edges</span>
                <span className="font-mono">{stats.edgeCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Communities</span>
                <span className="font-mono">{stats.communityCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Files</span>
                <span className="font-mono">{stats.fileCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Extracted</span>
                <span className="font-mono text-emerald-500">{stats.extractedEdges}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Inferred</span>
                <span className="font-mono text-blue-500">{stats.inferredEdges}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ambiguous</span>
                <span className="font-mono text-amber-500">{stats.ambiguousEdges}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No stats available.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

export function KnowledgeGraphPage() {
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState<string>('');
  const [tab, setTab] = useState('graph');

  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Knowledge Graph</h1>
          <p className="text-sm text-muted-foreground">
            Multi-layered code graph — code, documents, rationales, and concepts with community clustering.
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
      <main className="min-h-0 flex-1 relative flex flex-col">
        {projectId ? (
          <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 flex flex-col">
            <div className="border-b px-6 py-2">
              <TabsList>
                <TabsTrigger value="graph" className="gap-1.5">
                  <NetworkIcon className="size-3.5" />
                  Graph Viz
                </TabsTrigger>
                <TabsTrigger value="query" className="gap-1.5">
                  <SearchIcon className="size-3.5" />
                  Query Explorer
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="graph" className="min-h-0 flex-1">
              <GraphVizTab projectId={projectId} />
            </TabsContent>
            <TabsContent value="query" className="min-h-0 flex-1">
              <QueryExplorerTab projectId={projectId} />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <NetworkIcon className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Select a project to view its knowledge graph.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
