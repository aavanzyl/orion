import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CopyIcon, EyeIcon, SearchIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkflowTemplateSummary } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { cn, copyToClipboard } from '@/lib/utils';
import { NODE_TYPES } from '@/features/workflow-builder/builder-model';
import { NODE_VISUALS } from '@/features/workflow-builder/workflow-node';

const NODE_TYPE_BLURB: Record<string, string> = {
  agent: 'an AI turn',
  shell: 'a deterministic script',
  approval: 'a human gate',
  scm: 'source-control actions like opening a PR',
};

export function WorkflowsPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<WorkflowTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    api
      .listWorkflowTemplates()
      .then(setTemplates)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return templates;
    const q = search.trim().toLowerCase();
    return templates.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.tags?.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [templates, search]);

  const copyYaml = async (name: string) => {
    setCopying(name);
    try {
      const detail = await api.getWorkflowTemplate(name);
      await copyToClipboard(detail.yaml);
      toast.success('Workflow YAML copied to clipboard');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCopying(null);
    }
  };

  const visualize = (name: string) => navigate(`/workflows/${encodeURIComponent(name)}`);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">Workflow templates</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          A workflow is a deterministic DAG of nodes the engine schedules for each ticket. Node
          types are <strong>agent</strong> (an AI turn), <strong>shell</strong> (a deterministic
          script), <strong>approval</strong> (a human gate), and <strong>scm</strong> (source-control
          actions like opening a PR). These are ready-made templates you can apply to a project&apos;s{' '}
          <code>.orion/config.yaml</code>.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          {NODE_TYPES.map((type) => {
            const visual = NODE_VISUALS[type];
            const Icon = visual.icon;
            return (
              <div key={type} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-md',
                    visual.badge,
                  )}
                >
                  <Icon className="size-3" />
                </span>
                <span className="font-medium text-foreground">{visual.label}</span>
                <span>— {NODE_TYPE_BLURB[type]}</span>
              </div>
            );
          })}
        </div>
      </header>

      <div className="flex items-center gap-2 border-b px-6 py-3">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workflows by name, description, or tag…"
            className="h-9 max-w-sm pl-8"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {templates.length} template{templates.length !== 1 ? 's' : ''}
          {search.trim() ? ' matching' : ''}
        </span>
      </div>

      <main className="flex-1 overflow-auto p-6">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 && search.trim() ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <SearchIcon className="size-8 text-muted-foreground" />
            <p className="text-muted-foreground">No templates match your search.</p>
          </div>
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Nodes</TableHead>
                  <TableHead>Types</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((template) => (
                  <TableRow
                    key={template.name}
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() => visualize(template.name)}
                  >
                    <TableCell>
                      <div className="font-medium">{template.title}</div>
                      <code className="text-xs text-muted-foreground">{template.name}</code>
                    </TableCell>
                    <TableCell className="max-w-sm whitespace-normal text-muted-foreground">
                      {template.description}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{template.nodeCount}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {template.nodeTypes.map((type) => (
                          <Badge key={type} variant="outline" className="font-mono">
                            {type}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {template.tags?.map((tag) => (
                          <Badge key={tag} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => visualize(template.name)}>
                          <EyeIcon data-icon="inline-start" />
                          Visualize
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyYaml(template.name)}
                          disabled={copying === template.name}
                        >
                          <CopyIcon data-icon="inline-start" />
                          Copy YAML
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && !search.trim() && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No workflow templates available.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </main>
    </div>
  );
}
