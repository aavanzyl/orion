import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import type { Provider, SkillCatalogEntry } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import {
  nextKey,
  sortNodes,
  type ConfigFormModel,
  type NodeFormModel,
} from './config-model';
import { NumberField } from '../shared/node-properties/fields';
import { WorkflowNodeDialog } from './workflow-node-dialog';

const TYPE_BADGE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  agent: 'default',
  approval: 'secondary',
  scm: 'outline',
  shell: 'outline',
  workflow: 'secondary',
};

function move<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export interface ConfigFormProps {
  model: ConfigFormModel;
  onChange: (model: ConfigFormModel) => void;
  disabled?: boolean;
  providers?: Provider[];
  onEditFile?: (path: string) => void;
  commandFiles?: string[];
  skillCatalog?: SkillCatalogEntry[];
}

export function ConfigForm({
  model,
  onChange,
  disabled,
  providers = [],
  onEditFile,
  commandFiles = [],
  skillCatalog = [],
}: ConfigFormProps) {
  const [nodeOpen, setNodeOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<NodeFormModel | null>(null);

  const patch = (partial: Partial<ConfigFormModel>) => onChange({ ...model, ...partial });

  const updateSwimlane = (index: number, value: string) =>
    patch({ swimlanes: model.swimlanes.map((c, i) => (i === index ? value : c)) });

  const addSwimlane = () => patch({ swimlanes: [...model.swimlanes, ''] });

  const removeSwimlane = (index: number) =>
    patch({ swimlanes: model.swimlanes.filter((_, i) => i !== index) });

  const setBudget = (key: 'maxTokens' | 'maxCostUsd', value: number | undefined) => {
    const next = { ...(model.budget ?? {}) };
    if (value === undefined) delete next[key];
    else next[key] = value;
    patch({ budget: Object.keys(next).length ? next : undefined });
  };

  const handleSaveNode = (saved: NodeFormModel) => {
    if (saved.key) {
      patch({
        nodes: model.nodes.map((n) => (n.key === saved.key ? { ...n, ...saved } : n)),
      });
    } else {
      patch({
        nodes: [...model.nodes, { ...saved, key: nextKey('node') }],
      });
    }
  };

  const removeNode = (key: string) =>
    patch({ nodes: model.nodes.filter((n) => n.key !== key) });

  const issueTypes = model.issueTypes ?? [];

  const updateIssueType = (index: number, field: string, value: string) => {
    const next = [...issueTypes];
    const existing = next[index] ?? { name: '', label: '', workflow: '' };
    next[index] = { ...existing, [field]: value };
    patch({ issueTypes: next.filter((it) => it.name || it.label) });
  };

  const addIssueType = () =>
    patch({ issueTypes: [...issueTypes, { name: '', label: '', workflow: model.workflowName || 'default' }] });

  const removeIssueType = (index: number) =>
    patch({ issueTypes: issueTypes.filter((_, i) => i !== index) });

  const workflowNames = [
    model.workflowName || 'default',
    ...Object.keys(model.workflows ?? {}),
  ].filter(Boolean);

  const openNew = () => {
    setEditingNode(null);
    setNodeOpen(true);
  };

  const openEdit = (node: NodeFormModel) => {
    setEditingNode(node);
    setNodeOpen(true);
  };

  const swimlaneOptions = model.swimlanes.map((c) => c.trim()).filter(Boolean);
  const sortedNodes = sortNodes(model.nodes, model.swimlanes);

  return (
    <div className="flex flex-col gap-6">
      {/* Project */}
      <section className="flex flex-col gap-3">
        <SectionHeader title="Project" description="Identity of this repository." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="cfg-project-name">
            <Input
              id="cfg-project-name"
              value={model.projectName}
              disabled={disabled}
              onChange={(e) => patch({ projectName: e.target.value })}
              placeholder="my-project"
            />
          </Field>
          <Field label="Default branch" htmlFor="cfg-default-branch">
            <Input
              id="cfg-default-branch"
              value={model.defaultBranch}
              disabled={disabled}
              onChange={(e) => patch({ defaultBranch: e.target.value })}
              placeholder="main"
            />
          </Field>
        </div>
        <Field
          label="Branch format"
          htmlFor="cfg-branch-format"
          hint="Template for run branches. Supports $TICKET_ID, $TICKET_SLUG, $WORKFLOW_NAME, $RUN_ID."
        >
          <Input
            id="cfg-branch-format"
            value={model.branchFormat ?? ''}
            disabled={disabled}
            onChange={(e) => patch({ branchFormat: e.target.value || undefined })}
            placeholder="orion/$TICKET_SLUG-$RUN_ID_SHORT-$RANDOM"
            className="font-mono"
          />
        </Field>
      </section>

      <Separator />

      {/* Board */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <SectionHeader
            title="Board swimlanes"
            description="Ordered Kanban swimlanes. Order matters."
          />
          <Button variant="outline" size="sm" onClick={addSwimlane} disabled={disabled}>
            <PlusIcon data-icon="inline-start" />
            Add swimlane
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {model.swimlanes.map((swimlane, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="w-6 text-right text-xs text-muted-foreground">
                {index + 1}.
              </span>
              <Input
                value={swimlane}
                disabled={disabled}
                onChange={(e) => updateSwimlane(index, e.target.value)}
                placeholder="in_progress"
                className="font-mono"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => patch({ swimlanes: move(model.swimlanes, index, -1) })}
                disabled={disabled || index === 0}
                aria-label="Move swimlane up"
              >
                <ChevronUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => patch({ swimlanes: move(model.swimlanes, index, 1) })}
                disabled={disabled || index === model.swimlanes.length - 1}
                aria-label="Move swimlane down"
              >
                <ChevronDownIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive"
                onClick={() => removeSwimlane(index)}
                disabled={disabled}
                aria-label="Remove swimlane"
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-1.5 -mt-1.5">
        <Label htmlFor="trigger-swimlane" className="text-sm">Auto-trigger swimlane</Label>
        <p className="text-xs text-muted-foreground">
          Moving a ticket to this swimlane auto-starts a workflow when the ticket has no prior runs.
        </p>
        <Select
          value={model.triggerSwimlane ?? ''}
          onValueChange={(v) => patch({ triggerSwimlane: v === '__none__' ? undefined : v || undefined })}
          disabled={disabled}
        >
          <SelectTrigger id="trigger-swimlane">
            <SelectValue placeholder="None (disabled)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None (disabled)</SelectItem>
            {model.swimlanes.filter((c) => c.trim()).map((sw) => (
              <SelectItem key={sw} value={sw}>{sw}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* Issue Types */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <SectionHeader
            title="Issue types"
            description="Map ticket types to workflows. &quot;epic&quot; is always available."
          />
          <Button variant="outline" size="sm" onClick={addIssueType} disabled={disabled}>
            <PlusIcon data-icon="inline-start" />
            Add type
          </Button>
        </div>
        {issueTypes.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No custom types configured. The defaults (feature, bug, issue, hotfix) apply.
          </p>
        )}
        {issueTypes.length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {issueTypes.map((it, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Input
                        value={it.name}
                        disabled={disabled}
                        onChange={(e) => {
                          const newName = e.target.value;
                          updateIssueType(index, 'name', newName);
                          const autoLabel = newName ? newName.charAt(0).toUpperCase() + newName.slice(1) : '';
                          if (!it.label) {
                            updateIssueType(index, 'label', autoLabel);
                          }
                        }}
                        placeholder="feature"
                        className="font-mono"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={it.label}
                        disabled={disabled}
                        onChange={(e) => updateIssueType(index, 'label', e.target.value)}
                        placeholder="Feature"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={it.workflow}
                        disabled={disabled}
                        onValueChange={(v) => updateIssueType(index, 'workflow', v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a workflow" />
                        </SelectTrigger>
                        <SelectContent>
                          {workflowNames.map((name) => (
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
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeIssueType(index)}
                        disabled={disabled}
                        aria-label="Remove issue type"
                      >
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <Separator />

      {/* Workflows */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <SectionHeader
            title="Workflows"
            description="Additional workflows that issue types or workflow nodes can reference."
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const name = `workflow-${Date.now().toString(36)}`;
              patch({
                workflows: {
                  ...model.workflows,
                  [name]: { name, nodes: [{ id: 'start', type: 'shell' as const, script: 'echo ready' }] },
                },
              });
            }}
            disabled={disabled}
          >
            <PlusIcon data-icon="inline-start" />
            Add workflow
          </Button>
        </div>
        {!model.workflows || Object.keys(model.workflows).length === 0 ? (
          <p className="text-xs text-muted-foreground">No additional workflows defined.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {Object.entries(model.workflows ?? {}).map(([key, wf]) => (
              <div key={key} className="flex items-center gap-2">
                <Input
                  value={key}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = { ...model.workflows };
                    const value = next[key];
                    delete next[key];
                    next[e.target.value || key] = { ...value, name: e.target.value || key };
                    patch({ workflows: next });
                  }}
                  placeholder="workflow-name"
                  className="font-mono flex-1"
                />
                <Badge variant="secondary" className="text-xs whitespace-nowrap">
                  {wf.nodes.length} node{wf.nodes.length !== 1 ? 's' : ''}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    const next = { ...model.workflows };
                    delete next[key];
                    patch({ workflows: Object.keys(next).length > 0 ? next : undefined });
                  }}
                  disabled={disabled}
                  aria-label="Remove workflow"
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <Separator />

      {/* Workflow */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <SectionHeader
            title="Workflow"
            description="Nodes are ordered by swimlane, then by their depends-on relationship."
          />
          <Button variant="outline" size="sm" onClick={openNew} disabled={disabled}>
            <PlusIcon data-icon="inline-start" />
            Add node
          </Button>
        </div>

        <Field label="Workflow name" htmlFor="cfg-workflow-name">
          <Input
            id="cfg-workflow-name"
            value={model.workflowName}
            disabled={disabled}
            onChange={(e) => patch({ workflowName: e.target.value })}
            placeholder="default"
          />
        </Field>

        {model.nodes.length > 0 ? (
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Id</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Swimlane</TableHead>
                  <TableHead>Depends on</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedNodes.map((node) => (
                  <TableRow key={node.key}>
                    <TableCell>
                      <span className="font-mono text-sm font-medium">
                        {node.id.trim() || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={TYPE_BADGE_VARIANTS[node.type] ?? 'outline'}
                        className="text-[10px]"
                      >
                        {node.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                      {node.type === 'agent' && (
                        <span>
                          {node.provider?.trim()}
                          {node.provider?.trim() && node.model?.trim() && ' — '}
                          {node.model?.trim()}
                          {!node.provider?.trim() && !node.model?.trim() && '—'}
                        </span>
                      )}
                      {node.type === 'scm' && (
                        <code className="text-[11px]">{node.action?.trim() || '—'}</code>
                      )}
                      {node.type === 'shell' && (
                        <code className="text-[11px]">{node.script?.trim() || '—'}</code>
                      )}
                      {node.type === 'message' && (
                        <span className="truncate">
                          {node.agentGenerated
                            ? `${node.messageTarget ?? 'notify'}: agent-written`
                            : node.message?.trim() || '—'}
                        </span>
                      )}
                      {node.type === 'condition' && (
                        <code className="text-[11px]">{node.condition?.trim() || '—'}</code>
                      )}
                      {node.type === 'http' && (
                        <code className="text-[11px]">
                          {node.url?.trim() ? `${(node.method ?? 'GET')} ${node.url.trim()}` : '—'}
                        </code>
                      )}
                      {node.type === 'graphql' && (
                        <code className="text-[11px]">{node.url?.trim() || '—'}</code>
                      )}
                      {(node.type === 'approval' || node.type === 'workflow') && '—'}
                    </TableCell>
                    <TableCell>
                      {node.swimlane ? (
                        <code className="text-xs text-muted-foreground">{node.swimlane}</code>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {node.dependsOn.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {node.dependsOn.map((dep) => (
                            <Badge key={dep} variant="outline" className="font-mono text-[10px]">
                              {dep}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEdit(node)}
                          disabled={disabled}
                          aria-label="Edit node"
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => removeNode(node.key)}
                          disabled={disabled}
                          aria-label="Remove node"
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No nodes yet. Add one to define the workflow.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Max tokens (budget)"
            value={model.budget?.maxTokens}
            onChange={(v) => setBudget('maxTokens', v)}
            placeholder="unlimited"
          />
          <NumberField
            label="Max cost USD (budget)"
            value={model.budget?.maxCostUsd}
            onChange={(v) => setBudget('maxCostUsd', v)}
            placeholder="unlimited"
          />
        </div>
      </section>

      <WorkflowNodeDialog
        open={nodeOpen}
        onOpenChange={setNodeOpen}
        node={editingNode}
        swimlaneOptions={swimlaneOptions}
        otherNodes={model.nodes.map((n) => ({ id: n.id.trim(), key: n.key })).filter((n) => n.id)}
        providers={providers}
        onEditFile={onEditFile}
        commandFiles={commandFiles}
        skillCatalog={skillCatalog}
        onSave={handleSaveNode}
      />
    </div>
  );
}
