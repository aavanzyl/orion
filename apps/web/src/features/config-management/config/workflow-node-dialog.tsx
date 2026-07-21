import { useEffect, useState } from 'react';
import { InfoIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type {
  McpServerConfig,
  Provider,
  SkillCatalogEntry,
  WorkflowNodeType,
} from '@orion/models';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  McpCatalogList,
  McpCustomForm,
  McpServersEditor,
  type McpCatalogEntry,
} from '@/features/settings/mcp-servers-editor';
import {
  defaultInstructionsPath,
  NODE_TYPES,
  NODE_TYPE_DESCRIPTIONS,
  NODE_TYPE_LABELS,
  type NodeData,
} from '../shared/node-model';
import { InstructionsField } from '../shared/instructions-field';
import { Checkbox, NumberField } from '../shared/node-properties/fields';
import { LoopEditor } from '../shared/node-properties/loop-editor';
import { ScmProperties } from '../shared/node-properties/scm-properties';
import { MessageProperties } from '../shared/node-properties/message-properties';
import { ConditionProperties } from '../shared/node-properties/condition-properties';
import { HttpProperties } from '../shared/node-properties/http-properties';
import { GraphqlProperties } from '../shared/node-properties/graphql-properties';
import { type NodeFormModel } from './config-model';

const NONE = '__none__';

type NodeDialogView = 'node' | 'skills' | 'mcp-catalog' | 'mcp-custom';

export interface WorkflowNodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node?: NodeFormModel | null;
  swimlaneOptions: string[];
  otherNodes: { id: string; key: string }[];
  providers: Provider[];
  onEditFile?: (path: string) => void;
  /** Known `.orion/` command file paths used to autocomplete the instructions path. */
  commandFiles?: string[];
  skillCatalog?: SkillCatalogEntry[];
  onSave: (node: NodeFormModel) => void;
}

export function WorkflowNodeDialog({
  open,
  onOpenChange,
  node,
  swimlaneOptions,
  otherNodes,
  providers,
  onEditFile,
  commandFiles = [],
  skillCatalog = [],
  onSave,
}: WorkflowNodeDialogProps) {
  const editing = Boolean(node);
  const [id, setId] = useState('');
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [data, setData] = useState<NodeData>({ type: 'agent' });
  const [instructionsTouched, setInstructionsTouched] = useState(false);
  const [view, setView] = useState<NodeDialogView>('node');

  const patch = (partial: Partial<NodeData>) => setData((d) => ({ ...d, ...partial }));

  useEffect(() => {
    if (!open) return;
    setView('node');
    setId(node?.id ?? '');
    setDependsOn(node?.dependsOn ?? []);
    setInstructionsTouched(Boolean(node?.instructions));
    if (node) {
      const { key: _key, id: _id, dependsOn: _dependsOn, ...rest } = node;
      void _key;
      void _id;
      void _dependsOn;
      setData(rest);
    } else {
      setData({ type: 'agent', provider: 'codex' });
    }
  }, [open, node]);

  // Until the user overrides the instructions path, keep it defaulted to
  // `instructions/<id>.md` so every agent gets a sensible, editable file.
  useEffect(() => {
    if (!open || !id.trim() || data.type !== 'agent' || instructionsTouched) return;
    setData((d) => ({ ...d, instructions: defaultInstructionsPath(id) }));
  }, [open, data.type, id, instructionsTouched]);

  const providerKeys = Array.from(new Set(providers.map((p) => p.key))).sort();
  const modelsFor = (providerKey: string | undefined): string[] => {
    const matching = providers
      .filter((p) => p.key === (providerKey ?? '').trim())
      .flatMap((p) => p.models);
    const pool = matching.length > 0 ? matching : providers.flatMap((p) => p.models);
    return Array.from(new Set(pool)).sort();
  };

  const skills = data.skills ?? [];
  const mcpServers = data.mcpServers ?? {};
  const isAgent = data.type === 'agent';
  const isShell = data.type === 'shell';
  const isScm = data.type === 'scm';
  const isApproval = data.type === 'approval';
  const isMessage = data.type === 'message';
  const isCondition = data.type === 'condition';
  const isHttp = data.type === 'http';
  const isGraphql = data.type === 'graphql';
  const canLoop = isAgent;
  const supportsRetryPolicy = isAgent || isHttp || isGraphql;

  const valid = id.trim().length > 0;

  const handleSave = () => {
    if (!valid) return;
    onSave({
      key: node?.key ?? '',
      id: id.trim(),
      dependsOn,
      ...data,
    });
    onOpenChange(false);
  };

  const addSkill = (skillName: string) => {
    patch({ skills: [...skills, skillName] });
    setView('node');
  };

  const addMcpFromCatalog = (entry: McpCatalogEntry) => {
    patch({ mcpServers: { ...mcpServers, [entry.key]: entry.config } });
    setView('node');
  };

  const addMcpCustom = (name: string, config: McpServerConfig) => {
    patch({ mcpServers: { ...mcpServers, [name]: config } });
    setView('node');
  };

  const handleDialogOpenChange = (next: boolean) => {
    if (next) return;
    if (view !== 'node') {
      setView('node');
      return;
    }
    onOpenChange(false);
  };

  const availableSkills = skillCatalog.filter((skill) => !skills.includes(skill.name));

  const toggleDep = (depId: string) => {
    setDependsOn((prev) =>
      prev.includes(depId) ? prev.filter((d) => d !== depId) : [...prev, depId],
    );
  };

  const filteredDepOptions = otherNodes.filter((o) => o.key !== node?.key);

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      {view === 'node' && (
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit node' : 'Add node'}</DialogTitle>
            <DialogDescription>
              A workflow node is a step in the DAG the engine schedules and runs.
            </DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wn-type">Type</Label>
              <Select value={data.type} onValueChange={(v) => patch({ type: v as WorkflowNodeType })}>
                <SelectTrigger id="wn-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NODE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {NODE_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{NODE_TYPE_DESCRIPTIONS[data.type as keyof typeof NODE_TYPE_DESCRIPTIONS]}</p>
            </div>

            <Separator />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wn-id">Id</Label>
              <Input
                id="wn-id"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="implement"
              />
            </div>

            {isAgent && (
              <div className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="wn-provider">Provider</Label>
                    <Select value={data.provider ?? ''} onValueChange={(v) => patch({ provider: v })}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="e.g. codex" />
                      </SelectTrigger>
                      <SelectContent>
                        {providerKeys.map((k) => (
                          <SelectItem key={k} value={k}>
                            {k}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="wn-model">Model</Label>
                    <Select value={data.model ?? ''} onValueChange={(v) => patch({ model: v })}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="e.g. gpt-5-codex" />
                      </SelectTrigger>
                      <SelectContent>
                        {modelsFor(data.provider).map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <InstructionsField
                  value={data.instructions ?? ''}
                  onChange={(v) => {
                    patch({ instructions: v });
                    setInstructionsTouched(true);
                  }}
                  commandFiles={commandFiles}
                  onEditFile={onEditFile}
                  nodeId={id}
                />

                {skillCatalog.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <Separator />
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <div>
                        <span className="text-sm font-medium">Skills</span>
                        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
                          Skills are instruction bundles that guide how the agent works.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setView('skills')}
                        disabled={skills.length >= skillCatalog.length}
                      >
                        <PlusIcon data-icon="inline-start" />
                        Add skill
                      </Button>
                    </div>
                    {skills.length > 0 ? (
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead>Source</TableHead>
                              <TableHead className="w-0" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {skills.map((skillName) => {
                              const entry = skillCatalog.find((s) => s.name === skillName);
                              return (
                                <TableRow key={skillName}>
                                  <TableCell>
                                    <span className="font-mono text-sm font-medium">{skillName}</span>
                                  </TableCell>
                                  <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                                    {entry?.description ?? '—'}
                                  </TableCell>
                                  <TableCell>
                                    {entry?.source === 'builtin' ? (
                                      <Badge variant="secondary" className="text-[10px]">
                                        built-in
                                      </Badge>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      className="text-destructive hover:text-destructive"
                                      onClick={() =>
                                        patch({ skills: skills.filter((s) => s !== skillName) })
                                      }
                                      aria-label={`Remove ${skillName}`}
                                    >
                                      <Trash2Icon />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className="py-2 text-center text-xs text-muted-foreground">
                        No skills added.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <Separator />
                  <div className="mt-1 flex flex-col gap-2">
                    <span className="text-sm font-medium">MCP Servers</span>
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
                      MCP servers give the agent access to external tools.
                    </p>
                    <McpServersEditor
                      mcpServers={mcpServers}
                      onChange={(servers) => patch({ mcpServers: servers })}
                      onRequestAddCatalog={() => setView('mcp-catalog')}
                      onRequestAddCustom={() => setView('mcp-custom')}
                    />
                  </div>
                </div>
              </div>
            )}

            {isScm && <ScmProperties data={data} onChange={patch} />}

            {isShell && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wn-script">Script</Label>
                <Textarea
                  id="wn-script"
                  value={data.script ?? ''}
                  onChange={(e) => patch({ script: e.target.value })}
                  placeholder="npm test"
                  spellCheck={false}
                  className="min-h-24 font-mono text-xs"
                />
              </div>
            )}

            {isApproval && (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                This node pauses the run for a manual approval before dependents proceed.
              </p>
            )}

            {isMessage && <MessageProperties data={data} onChange={patch} />}
            {isCondition && (
              <ConditionProperties
                data={data}
                onChange={patch}
                targetOptions={otherNodes
                  .filter((n) => n.key !== node?.key)
                  .map((n) => n.id)}
                referenceOptions={otherNodes
                  .filter((n) => n.key !== node?.key)
                  .map((n) => n.id)}
              />
            )}
            {isHttp && <HttpProperties data={data} onChange={patch} />}
            {isGraphql && <GraphqlProperties data={data} onChange={patch} />}

            <Separator />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wn-swimlane">Swimlane</Label>
              <Select
                value={data.swimlane || NONE}
                onValueChange={(v) => patch({ swimlane: v === NONE ? undefined : v })}
              >
                <SelectTrigger id="wn-swimlane" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {swimlaneOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Depends on</Label>
              {filteredDepOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No other nodes yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {filteredDepOptions.map((other) => {
                    const active = dependsOn.includes(other.id);
                    return (
                      <button key={other.key} type="button" onClick={() => toggleDep(other.id)}>
                        <Badge
                          variant={active ? 'default' : 'outline'}
                          className="cursor-pointer font-mono"
                        >
                          {other.id}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {supportsRetryPolicy && (
              <>
                <Separator />
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="Retries"
                    value={data.retries}
                    onChange={(v) => patch({ retries: v })}
                    placeholder="0"
                  />
                  <NumberField
                    label="Retry delay (ms)"
                    value={data.retryDelayMs}
                    onChange={(v) => patch({ retryDelayMs: v })}
                    placeholder="5000"
                  />
                </div>
                <NumberField
                  label="Timeout (ms)"
                  value={data.timeoutMs}
                  onChange={(v) => patch({ timeoutMs: v })}
                  placeholder="300000"
                />
              </>
            )}
            <Checkbox
              checked={Boolean(data.continueOnError)}
              onChange={(v) => patch({ continueOnError: v || undefined })}
            >
              Continue on error
            </Checkbox>

            <Checkbox
              checked={data.onFailureTransitionTo !== undefined}
              onChange={(v) =>
                patch({ onFailureTransitionTo: v ? '' : undefined })
              }
            >
              On failure, transition to
            </Checkbox>
            {data.onFailureTransitionTo !== undefined && (
              <div className="ml-6 mt-1">
                <Select
                  value={data.onFailureTransitionTo || '__none__'}
                  onValueChange={(v) =>
                    patch({ onFailureTransitionTo: v === '__none__' ? '' : v })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select target node..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select target node...</SelectItem>
                    <SelectItem value="__divider__" disabled className="text-[10px] font-semibold text-muted-foreground">
                      — Nodes —
                    </SelectItem>
                    {otherNodes
                      .filter((o) => o.key !== node?.key)
                      .map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.id}
                        </SelectItem>
                      ))}
                    {swimlaneOptions.length > 0 && (
                      <>
                        <SelectItem value="__divider_sw__" disabled className="text-[10px] font-semibold text-muted-foreground">
                          — Swimlanes —
                        </SelectItem>
                        {swimlaneOptions.map((sw) => (
                          <SelectItem key={`sw_${sw}`} value={sw}>
                            {sw}
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {(canLoop) && (
              <>
                <Separator />
                {canLoop && (
                  <>
                    <Checkbox
                      checked={Boolean(data.loop)}
                      onChange={(v) => patch({ loop: v ? { maxIterations: 3, until: 'DONE' } : undefined })}
                    >
                      <span className="font-medium">Loop this node</span>
                    </Checkbox>
                    {data.loop && <LoopEditor loop={data.loop} onChange={(loop) => patch({ loop })} />}
                  </>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!valid}>
              {editing ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}

      {view === 'skills' && (
        <DialogContent className="flex max-h-[70vh] max-w-md flex-col">
          <DialogHeader>
            <DialogTitle>Add skill</DialogTitle>
            <DialogDescription>Select a skill to enable for this agent node.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
            {availableSkills.map((skill) => (
              <button
                key={skill.name}
                type="button"
                onClick={() => addSkill(skill.name)}
                className="cursor-pointer rounded-md border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{skill.name}</span>
                  {skill.source === 'builtin' && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      built-in
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
              </button>
            ))}
            {availableSkills.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                All available skills have been added.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setView('node')}>
              Back
            </Button>
          </DialogFooter>
        </DialogContent>
      )}

      {view === 'mcp-catalog' && (
        <DialogContent className="flex max-h-[70vh] max-w-md flex-col">
          <DialogHeader>
            <DialogTitle>Add MCP Server</DialogTitle>
            <DialogDescription>Select a pre-configured MCP server from the catalog.</DialogDescription>
          </DialogHeader>
          <McpCatalogList mcpServers={mcpServers} onAdd={addMcpFromCatalog} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setView('node')}>
              Back
            </Button>
          </DialogFooter>
        </DialogContent>
      )}

      {view === 'mcp-custom' && (
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Custom MCP Server</DialogTitle>
            <DialogDescription>Configure a stdio or HTTP MCP server.</DialogDescription>
          </DialogHeader>
          <McpCustomForm onAdd={addMcpCustom} onCancel={() => setView('node')} cancelLabel="Back" />
        </DialogContent>
      )}
    </Dialog>
  );
}
