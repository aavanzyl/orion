import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { parse } from 'yaml';
import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type OnConnect,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeftIcon, CopyIcon, EyeIcon, LayoutGridIcon, PlusIcon, SaveIcon, SlidersHorizontalIcon, SparklesIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { BudgetConfig, IssueTypeConfig, Provider, SkillCatalogEntry, WorkflowConfig, WorkflowNodeType } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { api, type WorkflowTemplateDetail } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import {
  buildFullYaml,
  clampYToLane,
  defaultInstructionsPath,
  graphToWorkflow,
  laneContentTop,
  laneForY,
  layoutSwimlanes,
  NODE_CARD_HEIGHT,
  NODE_TYPES,
  nextNodeKey,
  UNASSIGNED_LANE,
  validateGraph,
  workflowToGraph,
  wouldCreateCycle,
  type BuilderNode,
  type BuilderNodeData,
  type Lane,
} from './builder-model';
import { WorkflowNode } from './workflow-node';
import { NodePalette, NODE_DND_MIME } from './node-palette';
import { SwimlaneLayer } from './swimlane-layer';
import { DeletableEdge } from './deletable-edge';
import { NodePropertiesPanel } from './node-properties-panel';
import { WorkflowTemplateDialog } from '../shared/workflow-template-dialog';

const nodeTypes = { workflow: WorkflowNode };
const edgeTypes = { deletable: DeletableEdge };

const defaultEdgeOptions = {
  type: 'deletable',
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  style: { strokeWidth: 1.5 },
};

interface LoadedData {
  projectName: string;
  configPath: string;
  rawYaml: string | null;
  workflowName: string;
  providers: Provider[];
  commandFiles: string[];
  swimlanes: string[];
  triggerSwimlane?: string;
  workflows: string[];
  issueTypes?: IssueTypeConfig[];
  subWorkflows?: Record<string, WorkflowConfig>;
  budget?: BudgetConfig;
  projectSettings: { name: string; defaultBranch: string; branchFormat?: string };
  initialNodes: BuilderNode[];
  initialEdges: Edge[];
}

/** Build a unique workflow node id for a freshly added node. */
function uniqueNodeId(type: WorkflowNodeType, existing: Set<string>): string {
  let i = 1;
  let candidate: string = type;
  while (existing.has(candidate)) {
    i += 1;
    candidate = `${type}_${i}`;
  }
  return candidate;
}

function BuilderCanvas({ data, projectId }: { data: LoadedData; projectId: string }) {
  const navigate = useNavigate();
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(data.initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(data.initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState(data.workflowName);
  const [budget, setBudget] = useState<BudgetConfig>(data.budget ?? {});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [rawYaml, setRawYaml] = useState(data.rawYaml);
  const [saving, setSaving] = useState(false);
  const [viewYaml, setViewYaml] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogEntry[]>([]);
  const [boardSwimlanes, setBoardSwimlanes] = useState<string[]>(data.swimlanes);
  const [triggerSwimlane, setTriggerSwimlane] = useState<string>(data.triggerSwimlane ?? '');
  const [projectName, setProjectName] = useState(data.projectSettings.name);
  const [defaultBranch, setDefaultBranch] = useState(data.projectSettings.defaultBranch);
  const [branchFormat, setBranchFormat] = useState(data.projectSettings.branchFormat ?? '');
  const [issueTypes, setIssueTypes] = useState<IssueTypeConfig[]>(data.issueTypes ?? []);
  const [subWorkflows, setSubWorkflows] = useState<Record<string, WorkflowConfig>>(data.subWorkflows ?? {});
  const [activeWorkflowKey, setActiveWorkflowKey] = useState<string>('main');
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = true;
  }, [nodes, edges]);
  const mainWorkflowStateRef = useRef<{ workflowName: string; budget: BudgetConfig; nodes: BuilderNode[]; edges: Edge[] }>({
    workflowName: data.workflowName,
    budget: data.budget ?? {},
    nodes: data.initialNodes,
    edges: data.initialEdges,
  });

  const mainWorkflowDisplayName = useMemo(
    () =>
      activeWorkflowKey === 'main'
        ? workflowName || 'default'
        : mainWorkflowStateRef.current.workflowName || 'default',
    [activeWorkflowKey, workflowName],
  );

  const switchWorkflow = useCallback((key: string) => {
    if (key === activeWorkflowKey) return;
    if (activeWorkflowKey === 'main') {
      mainWorkflowStateRef.current = { workflowName, budget, nodes, edges };
    } else {
      const currentWf = graphToWorkflow(workflowName, nodes, edges, budget);
      setSubWorkflows((prev) => ({ ...prev, [activeWorkflowKey]: currentWf }));
    }
    if (key === 'main') {
      const saved = mainWorkflowStateRef.current;
      setWorkflowName(saved.workflowName);
      setBudget(saved.budget);
      setNodes(saved.nodes);
      setEdges(saved.edges);
      setActiveWorkflowKey('main');
    } else {
      const wf = subWorkflows[key];
      if (wf) {
        setWorkflowName(wf.name);
        setBudget(wf.budget ?? {});
        const graph = workflowToGraph(wf);
        const laid = layoutSwimlanes(graph.nodes, graph.edges, boardSwimlanes);
        setNodes(laid.nodes);
        setEdges(graph.edges.map((e) => ({ ...e, type: 'deletable' })));
        setActiveWorkflowKey(key);
      } else {
        toast.error(`Workflow "${key}" not found`);
        return;
      }
    }
    setSelectedId(null);
  }, [activeWorkflowKey, workflowName, nodes, edges, budget, subWorkflows, setNodes, setEdges, boardSwimlanes]);
  const defaultProviderKey = data.providers[0]?.key ?? 'codex';

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  // Swimlane bands are derived from the current nodes/edges so they always
  // reflect where things sit; node positions only change on drag or auto-arrange.
  const lanes = useMemo(
    () => layoutSwimlanes(nodes, edges, boardSwimlanes).lanes,
    [nodes, edges, boardSwimlanes],
  );
  const lanesRef = useRef<Lane[]>(lanes);
  useEffect(() => {
    lanesRef.current = lanes;
  }, [lanes]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const { source, target } = connection;
      if (!source || !target || source === target) return false;
      return !wouldCreateCycle(edges, source, target);
    },
    [edges],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const { source, target } = connection;
      if (!source || !target) return;
      if (source === target || wouldCreateCycle(edges, source, target)) return;
      setEdges((eds) =>
        addEdge({ ...connection, id: `e_${source}_${target}`, type: 'deletable' }, eds),
      );
    },
    [edges, setEdges],
  );

  const addNode = useCallback(
    (type: WorkflowNodeType, opts?: { position?: { x: number; y: number }; swimlane?: string }) => {
      const key = nextNodeKey();
      setNodes((nds) => {
        const existing = new Set(nds.map((n) => n.data.nodeId));
        let position = opts?.position;
        if (!position) {
          const lane =
            lanesRef.current.find((l) => l.key === UNASSIGNED_LANE) ??
            lanesRef.current[lanesRef.current.length - 1];
          const offset = nds.length % 4;
          position = {
            x: 40 + offset * 48,
            y: (lane ? laneContentTop(lane) : 60) + offset * 26,
          };
        }
        const nodeId = uniqueNodeId(type, existing);
        const newNode: BuilderNode = {
          id: key,
          type: 'workflow',
          position,
          data: {
            nodeId,
            type,
            provider: type === 'agent' ? defaultProviderKey : undefined,
            ...(type === 'agent' ? { instructions: defaultInstructionsPath(nodeId) } : {}),
            ...(opts?.swimlane ? { swimlane: opts.swimlane } : {}),
          },
        };
        return [...nds, newNode];
      });
      setSelectedId(key);
    },
    [setNodes, defaultProviderKey],
  );

  useEffect(() => {
    api.listSkills(projectId).then((res) => setSkillCatalog(res.skills)).catch(() => undefined);
  }, [projectId]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(NODE_DND_MIME) as WorkflowNodeType;
      if (!type || !(NODE_TYPES as readonly string[]).includes(type)) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const lane = laneForY(lanesRef.current, position.y + NODE_CARD_HEIGHT / 2);
      const swimlane = lane && lane.key !== UNASSIGNED_LANE ? lane.key : undefined;
      addNode(type, { position, swimlane });
    },
    [screenToFlowPosition, addNode],
  );

  // On drop of a dragged node, snap it into the lane it was released over and
  // adopt that lane's board swimlane.
  const onNodeDragStop: OnNodeDrag<BuilderNode> = useCallback(
    (_, node) => {
      const lane = laneForY(lanesRef.current, node.position.y + NODE_CARD_HEIGHT / 2);
      if (!lane) return;
      const swimlane = lane.key === UNASSIGNED_LANE ? undefined : lane.key;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id
            ? {
                ...n,
                position: { x: node.position.x, y: clampYToLane(lane, node.position.y) },
                data: { ...n.data, swimlane },
              }
            : n,
        ),
      );
    },
    [setNodes],
  );

  const patchSelected = useCallback(
    (patch: Partial<BuilderNodeData>) => {
      if (!selectedId) return;
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedId) return n;
          let position = n.position;
          if ('swimlane' in patch) {
            const laneKey = patch.swimlane || UNASSIGNED_LANE;
            const lane = lanesRef.current.find((l) => l.key === laneKey);
            if (lane) position = { x: n.position.x, y: laneContentTop(lane) };
          }
          return { ...n, position, data: { ...n.data, ...patch } };
        }),
      );
    },
    [selectedId, setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedId((current) => (current === id ? null : current));
    },
    [setNodes, setEdges],
  );

  const autoArrange = useCallback(() => {
    setNodes((nds) => layoutSwimlanes(nds, edges, boardSwimlanes).nodes);
  }, [edges, boardSwimlanes, setNodes]);

  const looksLikeFilePath = (v: string): boolean =>
    !v.includes('\n') && (v.startsWith('instructions/') || v.endsWith('.md'));

  // Replace the current canvas with a bundled workflow template, unioning in any
  // swimlanes the template suggests. Mirrors the config editor's template picker.
  const applyTemplate = useCallback(
    (detail: WorkflowTemplateDetail) => {
      try {
        const parsed = parse(detail.yaml) as Record<string, unknown> | null;
        const wf = (parsed?.workflow ?? parsed) as WorkflowConfig | undefined;
        if (!wf || !Array.isArray(wf.nodes)) {
          toast.error('Template has no workflow nodes');
          return;
        }
        const nextName = wf.name ?? workflowName;
        const graph = workflowToGraph({ ...wf, name: nextName });

        for (const node of graph.nodes) {
          if (node.data.type !== 'agent') continue;
          const inline = node.data.instructions?.trim();
          if (inline && !looksLikeFilePath(inline)) {
            const filePath = defaultInstructionsPath(node.data.nodeId);
            api.saveCommandFile(projectId, filePath, inline).catch(() => undefined);
            node.data.instructions = filePath;
          } else if (!node.data.instructions?.trim()) {
            node.data.instructions = defaultInstructionsPath(node.data.nodeId);
          }
        }

        const mergedSwimlanes = [...boardSwimlanes];
        for (const sw of detail.suggestedSwimlanes ?? []) {
          if (!mergedSwimlanes.includes(sw)) mergedSwimlanes.push(sw);
        }
        const laid = layoutSwimlanes(graph.nodes, graph.edges, mergedSwimlanes);
        setBoardSwimlanes(mergedSwimlanes);
        setWorkflowName(nextName);
        if (wf.budget) setBudget(wf.budget);
        setNodes(laid.nodes);
        setEdges(graph.edges.map((e) => ({ ...e, type: 'deletable' })));
        setSelectedId(null);
        toast.success(`Inserted “${detail.title}” — review and save`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [boardSwimlanes, workflowName, setNodes, setEdges, projectId],
  );

  const copyYaml = useCallback(async () => {
    const currentWorkflow = graphToWorkflow(workflowName, nodes, edges, budget);
    const mainWorkflow = activeWorkflowKey === 'main'
      ? currentWorkflow
      : graphToWorkflow(
          mainWorkflowStateRef.current.workflowName,
          mainWorkflowStateRef.current.nodes,
          mainWorkflowStateRef.current.edges,
          mainWorkflowStateRef.current.budget,
        );
    const updatedSubWorkflows = activeWorkflowKey === 'main'
      ? { ...subWorkflows }
      : { ...subWorkflows, [activeWorkflowKey]: currentWorkflow };
    const yaml = buildFullYaml(rawYaml, {
      project: { name: projectName, defaultBranch: defaultBranch || 'main', branchFormat: branchFormat || undefined },
      workflow: mainWorkflow,
      board: { swimlanes: boardSwimlanes, ...(triggerSwimlane && triggerSwimlane !== '__none__' ? { triggerSwimlane } : {}) },
      subWorkflows: Object.keys(updatedSubWorkflows).length > 0 ? updatedSubWorkflows : undefined,
      issueTypes: issueTypes.length > 0 ? issueTypes : undefined,
    });
    try {
      await copyToClipboard(yaml);
      toast.success('Workflow YAML copied to clipboard');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [workflowName, nodes, edges, budget, rawYaml, projectName, defaultBranch, branchFormat, boardSwimlanes, triggerSwimlane, issueTypes, subWorkflows, activeWorkflowKey]);

  const save = useCallback(async () => {
    const issues = validateGraph(nodes);
    if (issues.length > 0) {
      toast.error(issues[0]);
      return;
    }
    const currentWorkflow = graphToWorkflow(workflowName, nodes, edges, budget);
    const mainWorkflow = activeWorkflowKey === 'main'
      ? currentWorkflow
      : graphToWorkflow(
          mainWorkflowStateRef.current.workflowName,
          mainWorkflowStateRef.current.nodes,
          mainWorkflowStateRef.current.edges,
          mainWorkflowStateRef.current.budget,
        );
    const updatedSubWorkflows = activeWorkflowKey === 'main'
      ? { ...subWorkflows }
      : { ...subWorkflows, [activeWorkflowKey]: currentWorkflow };
    const yaml = buildFullYaml(rawYaml, {
      project: { name: projectName, defaultBranch: defaultBranch || 'main', branchFormat: branchFormat || undefined },
      workflow: mainWorkflow,
      board: { swimlanes: boardSwimlanes, ...(triggerSwimlane && triggerSwimlane !== '__none__' ? { triggerSwimlane } : {}) },
      subWorkflows: Object.keys(updatedSubWorkflows).length > 0 ? updatedSubWorkflows : undefined,
      issueTypes: issueTypes.length > 0 ? issueTypes : undefined,
    });
    setSaving(true);
    try {
      await api.saveRawConfig(projectId, yaml);
      setRawYaml(yaml);
      dirtyRef.current = false;
      toast.success('Workflow saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, workflowName, budget, rawYaml, projectId, projectName, defaultBranch, branchFormat, boardSwimlanes, issueTypes, subWorkflows, activeWorkflowKey]);

  const setBudgetField = useCallback((key: keyof BudgetConfig, raw: string) => {
    setBudget((b) => ({ ...b, [key]: raw === '' ? undefined : Number(raw) }));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3 bg-card">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => navigate('/projects')} aria-label="Back">
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold">{data.projectName}</h1>
              <span className="text-xs text-muted-foreground">workflow</span>
            </div>
            <div className="flex items-center gap-2">
              <Select value={activeWorkflowKey} onValueChange={switchWorkflow}>
                <SelectTrigger className="h-6 w-40 border-none px-0 text-xs text-muted-foreground shadow-none focus-visible:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="main">{mainWorkflowDisplayName} (main)</SelectItem>
                  {Object.keys(subWorkflows).map((key) => (
                    <SelectItem key={key} value={key}>
                      {key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={saving}>
            <SaveIcon data-icon="inline-start" />
            Save
          </Button>
          <Button variant="outline" size="sm" onClick={autoArrange}>
            <LayoutGridIcon data-icon="inline-start" />
            Arrange
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTemplateOpen(true)}>
            <SparklesIcon data-icon="inline-start" />
            Template
          </Button>
          <Button variant="outline" size="sm" onClick={() => setViewYaml(true)}>
            <EyeIcon data-icon="inline-start" />
            View YAML
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <SlidersHorizontalIcon data-icon="inline-start" />
            Settings
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <NodePalette onAdd={(type) => addNode(type)} />
        <div className="relative min-w-0 flex-1 bg-card" onDrop={onDrop} onDragOver={onDragOver}>
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
              <p className="rounded-md bg-background/80 px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
                Drag a node from the left onto a lane, or click one to add.
              </p>
            </div>
          )}
          <ReactFlow<BuilderNode>
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            connectionRadius={44}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <SwimlaneLayer lanes={lanes} />
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        {selectedNode && (
          <NodePropertiesPanel
            node={selectedNode}
            projectId={projectId}
            providers={data.providers}
            swimlanes={boardSwimlanes}
            skillCatalog={skillCatalog}
            commandFiles={data.commandFiles}
            allNodeIds={nodes.map((n) => n.data.nodeId).filter(Boolean)}
            onChange={patchSelected}
            onDelete={() => deleteNode(selectedNode.id)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      <div className="flex items-center gap-4 border-t bg-card px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">Budget</span>
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] text-muted-foreground">Max tokens</label>
          <Input
            type="number"
            min={0}
            value={budget.maxTokens ?? ''}
            onChange={(e) => setBudgetField('maxTokens', e.target.value)}
            placeholder="∞"
            className="h-6 w-24 text-xs"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] text-muted-foreground">Max cost (USD)</label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={budget.maxCostUsd ?? ''}
            onChange={(e) => setBudgetField('maxCostUsd', e.target.value)}
            placeholder="∞"
            className="h-6 w-24 text-xs"
          />
        </div>
      </div>

      <WorkflowTemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        onApply={applyTemplate}
      />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Workflow settings</DialogTitle>
            <DialogDescription>
              Configure the project, board, and workflow budget.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="workflow" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="workflow" className="flex-1">Workflow</TabsTrigger>
              <TabsTrigger value="board" className="flex-1">Board</TabsTrigger>
              <TabsTrigger value="issueTypes" className="flex-1">Types</TabsTrigger>
              <TabsTrigger value="workflows" className="flex-1">Workflows</TabsTrigger>
              <TabsTrigger value="project" className="flex-1">Project</TabsTrigger>
            </TabsList>
            <TabsContent value="workflow" className="mt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Workflow name</Label>
                <Input
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  placeholder="default"
                />
              </div>
            </TabsContent>
            <TabsContent value="board" className="mt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Board swimlanes</Label>
                <p className="text-[11px] text-muted-foreground">
                  Drag to reorder. Swimlanes define the lanes in the Kanban board.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                {boardSwimlanes.map((lane, i) => (
                  <div key={`${lane}-${i}`} className="flex items-center gap-2">
                    <Input
                      value={lane}
                      onChange={(e) =>
                        setBoardSwimlanes((prev) => {
                          const next = [...prev];
                          next[i] = e.target.value;
                          return next;
                        })
                      }
                      className="h-8 text-sm"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={i === 0}
                      onClick={() =>
                        setBoardSwimlanes((prev) => {
                          const next = [...prev];
                          [next[i - 1], next[i]] = [next[i], next[i - 1]];
                          return next;
                        })
                      }
                      aria-label="Move up"
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={i === boardSwimlanes.length - 1}
                      onClick={() =>
                        setBoardSwimlanes((prev) => {
                          const next = [...prev];
                          [next[i], next[i + 1]] = [next[i + 1], next[i]];
                          return next;
                        })
                      }
                      aria-label="Move down"
                    >
                      ↓
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setBoardSwimlanes((prev) => prev.filter((_, j) => j !== i))
                      }
                      aria-label="Remove swimlane"
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBoardSwimlanes((prev) => [...prev, '']) }
              >
                <PlusIcon data-icon="inline-start" />
                Add swimlane
              </Button>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Auto-trigger swimlane</Label>
                <p className="text-[11px] text-muted-foreground">
                  Moving a ticket to this swimlane auto-starts a workflow when the ticket has no prior runs.
                </p>
                <Select
                  value={triggerSwimlane}
                  onValueChange={setTriggerSwimlane}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="None (disabled)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None (disabled)</SelectItem>
                    {boardSwimlanes.filter(Boolean).map((sw) => (
                      <SelectItem key={sw} value={sw}>{sw}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>
            <TabsContent value="issueTypes" className="mt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Issue types</Label>
                <p className="text-[11px] text-muted-foreground">
                  Map ticket types to workflows. &quot;epic&quot; is always available.
                </p>
              </div>
              {issueTypes.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  No custom types. Defaults (feature, bug, issue, hotfix) apply.
                </p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Name</TableHead>
                        <TableHead className="text-xs">Label</TableHead>
                        <TableHead className="text-xs">Workflow</TableHead>
                        <TableHead className="w-0" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {issueTypes.map((it, i) => {
                        const wfNames = [workflowName || 'default', ...Object.keys(subWorkflows)].filter(Boolean);
                        return (
                          <TableRow key={i}>
                            <TableCell>
                              <Input
                                value={it.name}
                                onChange={(e) =>
                                  setIssueTypes((prev) => {
                                    const next = [...prev];
                                    const newName = e.target.value;
                                    next[i] = {
                                      ...next[i],
                                      name: newName,
                                      label: next[i].label || (newName ? newName.charAt(0).toUpperCase() + newName.slice(1) : ''),
                                    };
                                    return next;
                                  })
                                }
                                placeholder="feature"
                                className="h-7 text-xs font-mono"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={it.label}
                                onChange={(e) =>
                                  setIssueTypes((prev) => {
                                    const next = [...prev];
                                    next[i] = { ...next[i], label: e.target.value };
                                    return next;
                                  })
                                }
                                placeholder="Feature"
                                className="h-7 text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={it.workflow}
                                onValueChange={(v) =>
                                  setIssueTypes((prev) => {
                                    const next = [...prev];
                                    next[i] = { ...next[i], workflow: v };
                                    return next;
                                  })
                                }
                              >
                                <SelectTrigger className="h-7 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {wfNames.map((name) => (
                                    <SelectItem key={name} value={name}>
                                      {name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() =>
                                  setIssueTypes((prev) => prev.filter((_, j) => j !== i))
                                }
                                aria-label="Remove issue type"
                              >
                                <XIcon />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setIssueTypes((prev) => [
                    ...prev,
                    { name: '', label: '', workflow: workflowName || 'default' },
                  ])
                }
              >
                <PlusIcon data-icon="inline-start" />
                Add type
              </Button>
            </TabsContent>
            <TabsContent value="workflows" className="mt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Workflows</Label>
                <p className="text-[11px] text-muted-foreground">
                  Additional workflows that issue types or workflow nodes can reference.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {Object.keys(subWorkflows).length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground">
                    No additional workflows.
                  </p>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">Nodes</TableHead>
                          <TableHead className="w-0" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(subWorkflows).map(([key, wf]) => (
                          <TableRow key={key}>
                            <TableCell>
                              <Input
                                value={key}
                                onChange={(e) =>
                                  setSubWorkflows((prev) => {
                                    const next = { ...prev };
                                    const value = next[key];
                                    delete next[key];
                                    next[e.target.value || key] = { ...value, name: e.target.value || key };
                                    return next;
                                  })
                                }
                                placeholder="workflow-name"
                                className="h-7 text-xs font-mono"
                              />
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-muted-foreground">
                                {wf.nodes.length} node{wf.nodes.length !== 1 ? 's' : ''}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => {
                                  setSubWorkflows((prev) => {
                                    const next = { ...prev };
                                    delete next[key];
                                    return next;
                                  });
                                }}
                                aria-label="Remove workflow"
                              >
                                <XIcon />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const name = `workflow-${Date.now().toString(36)}`;
                  setSubWorkflows((prev) => ({
                    ...prev,
                    [name]: {
                      name,
                      nodes: [{ id: 'start', type: 'shell', script: 'echo ready' }],
                    } as WorkflowConfig,
                  }));
                }}
              >
                <PlusIcon data-icon="inline-start" />
                Add workflow
              </Button>
            </TabsContent>
            <TabsContent value="project" className="mt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Project name</Label>
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="my-project"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Default branch</Label>
                <Input
                  value={defaultBranch}
                  onChange={(e) => setDefaultBranch(e.target.value)}
                  placeholder="main"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Branch format</Label>
                <Input
                  value={branchFormat}
                  onChange={(e) => setBranchFormat(e.target.value)}
                  placeholder="orion/$TICKET_SLUG-$RUN_ID_SHORT-$RANDOM"
                />
                <p className="text-[11px] text-muted-foreground">
                  Template with $TICKET_ID, $TICKET_SLUG, $WORKFLOW_NAME, $RUN_ID.
                </p>
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button size="sm" onClick={() => setSettingsOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewYaml} onOpenChange={setViewYaml}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Workflow YAML</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto">
            <pre className="bg-muted rounded-md p-4 text-xs font-mono whitespace-pre overflow-auto max-h-[60vh]">
              {(() => {
                const currentWorkflow = graphToWorkflow(workflowName, nodes, edges, budget);
                const mainWorkflow = activeWorkflowKey === 'main'
                  ? currentWorkflow
                  : graphToWorkflow(
                      mainWorkflowStateRef.current.workflowName,
                      mainWorkflowStateRef.current.nodes,
                      mainWorkflowStateRef.current.edges,
                      mainWorkflowStateRef.current.budget,
                    );
                const updatedSubWorkflows = activeWorkflowKey === 'main'
                  ? { ...subWorkflows }
                  : { ...subWorkflows, [activeWorkflowKey]: currentWorkflow };
                return buildFullYaml(rawYaml, {
                  project: { name: projectName, defaultBranch: defaultBranch || 'main', branchFormat: branchFormat || undefined },
                  workflow: mainWorkflow,
                  board: { swimlanes: boardSwimlanes, ...(triggerSwimlane && triggerSwimlane !== '__none__' ? { triggerSwimlane } : {}) },
                  subWorkflows: Object.keys(updatedSubWorkflows).length > 0 ? updatedSubWorkflows : undefined,
                  issueTypes: issueTypes.length > 0 ? issueTypes : undefined,
                });
              })()}
            </pre>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={copyYaml}>
              <CopyIcon data-icon="inline-start" />
              Copy
            </Button>
            <Button size="sm" onClick={() => setViewYaml(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function WorkflowBuilderPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [project, raw] = await Promise.all([
          api.getProject(projectId),
          api.getRawConfig(projectId),
        ]);
        let swimlanes: string[] = [];
        let triggerSwimlaneVal: string | undefined;
        let workflows: string[] = [];
        let budget: BudgetConfig | undefined;
        let issueTypes: IssueTypeConfig[] | undefined;
        let subWorkflowConfigs: Record<string, WorkflowConfig> | undefined;
        let workflowName = 'default';
        let graph = workflowToGraph(null);
        let projectName = project.name;
        let defaultBranchVal = 'main';
        let branchFormatVal: string | undefined;
        try {
          const config = await api.getProjectConfig(projectId);
          swimlanes = config.board?.swimlanes ?? [];
          triggerSwimlaneVal = config.board?.triggerSwimlane;
          workflows = config.workflows ?? [];
          budget = config.workflow?.budget;
          workflowName = config.workflow?.name ?? 'default';
          graph = workflowToGraph(config.workflow);
        } catch {
          // Config may not parse (or not exist yet); start from an empty canvas.
        }
        // Parse raw YAML for project settings.
        try {
          if (raw.content) {
            const parsed = parse(raw.content) as Record<string, unknown> | null;
            if (parsed && typeof parsed === 'object') {
              if (parsed.project && typeof parsed.project === 'object' && !Array.isArray(parsed.project)) {
                const p = parsed.project as Record<string, unknown>;
                if (typeof p.name === 'string') projectName = p.name;
                if (typeof p.defaultBranch === 'string') defaultBranchVal = p.defaultBranch;
                if (typeof p.branchFormat === 'string') branchFormatVal = p.branchFormat;
              }
              if (!triggerSwimlaneVal && parsed.board && typeof parsed.board === 'object' && !Array.isArray(parsed.board)) {
                const b = parsed.board as Record<string, unknown>;
                if (typeof b.triggerSwimlane === 'string') triggerSwimlaneVal = b.triggerSwimlane;
              }
            }
          }
        } catch {
          // Raw YAML may be unparseable; fall back to defaults.
        }
        // Providers and command files power the inline agent editor; both are
        // optional niceties, so failures fall back to empty lists.
        const [providers, commandFiles] = await Promise.all([
          api.listProviders().catch(() => [] as Provider[]),
          api
            .listCommandFiles(projectId)
            .then((res) => res.files)
            .catch(() => [] as string[]),
        ]);
          if (cancelled) return;
        // Extract issue types from raw YAML (not available via config endpoint).
        try {
          if (raw.content) {
            const parsed = parse(raw.content) as Record<string, unknown> | null;
            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.issueTypes)) {
              issueTypes = parsed.issueTypes as IssueTypeConfig[];
            }
          }
        } catch {
          // Raw YAML may be unparseable.
        }
        if (!issueTypes) {
          issueTypes = [
            { name: 'feature', label: 'Feature', workflow: workflowName },
            { name: 'bug', label: 'Bug', workflow: workflowName },
            { name: 'issue', label: 'Issue', workflow: workflowName },
            { name: 'hotfix', label: 'Hotfix', workflow: workflowName },
          ];
        }
        // Extract sub-workflows from raw YAML.
        try {
          if (raw.content) {
            const parsed = parse(raw.content) as Record<string, unknown> | null;
            if (parsed && typeof parsed === 'object' && parsed.workflows && typeof parsed.workflows === 'object' && !Array.isArray(parsed.workflows)) {
              subWorkflowConfigs = parsed.workflows as Record<string, WorkflowConfig>;
            }
          }
        } catch {
          // Raw YAML may be unparseable.
        }
        const laid = layoutSwimlanes(graph.nodes, graph.edges, swimlanes);
        setData({
          projectName: project.name,
          configPath: raw.configPath,
          rawYaml: raw.content,
          workflowName,
          providers,
          commandFiles,
          swimlanes,
          triggerSwimlane: triggerSwimlaneVal,
          workflows,
          issueTypes,
          subWorkflows: subWorkflowConfigs,
          budget,
          projectSettings: { name: projectName, defaultBranch: defaultBranchVal, branchFormat: branchFormatVal },
          initialNodes: laid.nodes,
          initialEdges: graph.edges.map((e) => ({ ...e, type: 'deletable' })),
        });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId) {
    return <p className="p-6 text-destructive">Missing project id.</p>;
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="flex-1" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-destructive">{error ?? 'Failed to load workflow.'}</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/projects')}>
          <ArrowLeftIcon data-icon="inline-start" />
          Back to projects
        </Button>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <BuilderCanvas data={data} projectId={projectId} />
    </ReactFlowProvider>
  );
}
