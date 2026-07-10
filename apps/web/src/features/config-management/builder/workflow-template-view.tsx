import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { parse as parseYaml } from 'yaml';
import { ArrowLeftIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkflowConfig } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import type { WorkflowTemplateDetail } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { workflowToGraph, layoutSwimlanes, type BuilderNode, type Lane } from './builder-model';
import { WorkflowNode } from './workflow-node';
import { SwimlaneLayer } from './swimlane-layer';

const nodeTypes = { workflow: WorkflowNode };

const defaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  style: { strokeWidth: 1.5 },
};

function TemplateCanvas({
  nodes,
  edges,
  lanes,
}: {
  nodes: BuilderNode[];
  edges: Edge[];
  lanes: Lane[];
}) {
  return (
    <ReactFlowProvider>
      <ReactFlow<BuilderNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <SwimlaneLayer lanes={lanes} />
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

export function WorkflowTemplateView() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<WorkflowTemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [view, setView] = useState<'diagram' | 'yaml'>('diagram');

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getWorkflowTemplate(name)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const graph = useMemo(() => {
    if (!detail) return null;
    try {
      const parsed = parseYaml(detail.yaml);
      const workflow = (parsed?.workflow ?? parsed) as WorkflowConfig;
      const base = workflowToGraph({ ...workflow, name: workflow.name ?? detail.name });
      const { nodes, lanes } = layoutSwimlanes(base.nodes, base.edges, detail.suggestedSwimlanes ?? []);
      return { nodes, edges: base.edges, lanes };
    } catch {
      return null;
    }
  }, [detail]);

  const copyYaml = async () => {
    if (!detail) return;
    setCopying(true);
    try {
      await copyToClipboard(detail.yaml);
      toast.success('Workflow YAML copied to clipboard');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCopying(false);
    }
  };

  if (!name) {
    return <p className="p-6 text-destructive">Missing workflow name.</p>;
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="flex-1" />
      </div>
    );
  }

  if (error || !detail || !graph) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-destructive">{error ?? 'Failed to load workflow template.'}</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/workflows')}>
          <ArrowLeftIcon data-icon="inline-start" />
          Back to workflows
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate('/workflows')}
            aria-label="Back"
          >
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold">{detail.title}</h1>
              <span className="text-xs text-muted-foreground">read-only</span>
            </div>
            <p className="truncate text-xs text-muted-foreground">{detail.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border p-0.5">
            <Button
              variant={view === 'diagram' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setView('diagram')}
            >
              Diagram
            </Button>
            <Button
              variant={view === 'yaml' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setView('yaml')}
            >
              YAML
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={copyYaml} disabled={copying}>
            <CopyIcon data-icon="inline-start" />
            Copy YAML
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {view === 'diagram' ? (
          <TemplateCanvas nodes={graph.nodes} edges={graph.edges} lanes={graph.lanes} />
        ) : (
          <div className="h-full overflow-auto p-4">
            <pre className="rounded-md bg-muted p-4 font-mono text-xs whitespace-pre">
              {detail.yaml}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
