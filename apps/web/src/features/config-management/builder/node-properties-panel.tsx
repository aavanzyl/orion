import { useMemo, useState } from 'react';
import { XIcon, Trash2Icon, InfoIcon, PlusIcon } from 'lucide-react';
import type {
  Provider,
  SkillCatalogEntry,
  WorkflowNodeType,
} from '@orion/models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { MarkdownFileEditor } from '@/features/config-management/shared/markdown-file-editor';
import {
  NODE_TYPES,
  NODE_TYPE_DESCRIPTIONS,
  NODE_TYPE_LABELS,
  type BuilderNode,
  type BuilderNodeData,
} from './builder-model';
import { NODE_VISUALS } from './workflow-node';
import { McpServersEditor } from '@/features/settings/mcp-servers-editor';
import { InstructionsField } from '../shared/instructions-field';
import { FieldLabel, Checkbox, NumberField } from '../shared/node-properties/fields';
import { LoopEditor } from '../shared/node-properties/loop-editor';
import { ScmProperties } from '../shared/node-properties/scm-properties';
import { MessageProperties } from '../shared/node-properties/message-properties';
import { ConditionProperties } from '../shared/node-properties/condition-properties';
import { HttpProperties } from '../shared/node-properties/http-properties';
import { GraphqlProperties } from '../shared/node-properties/graphql-properties';

const NONE = '__none__';

function visualFor(type: WorkflowNodeType) {
  return NODE_VISUALS[type as keyof typeof NODE_VISUALS] ?? NODE_VISUALS.shell;
}

interface NodePropertiesPanelProps {
  node: BuilderNode | null;
  projectId: string;
  providers: Provider[];
  swimlanes: string[];
  skillCatalog: SkillCatalogEntry[];
  /** Known `.orion/` command file paths used to autocomplete the instructions path. */
  commandFiles?: string[];
  /** All node ids in the graph, used to populate the condition target select. */
  allNodeIds?: string[];
  onChange: (patch: Partial<BuilderNodeData>) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function NodePropertiesPanel({
  node,
  projectId,
  providers,
  swimlanes,
  skillCatalog,
  commandFiles = [],
  allNodeIds = [],
  onChange,
  onDelete,
  onClose,
}: NodePropertiesPanelProps) {
  const [editFile, setEditFile] = useState<string | null>(null);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);

  const providerKeys = useMemo(
    () => [...new Set(providers.map((p) => p.key).filter(Boolean))],
    [providers],
  );
  const modelsFor = (providerKey: string | undefined) => [
    ...new Set(providers.filter((p) => p.key === providerKey).flatMap((p) => p.models)),
  ];

  if (!node) return null;
  const data = node.data;
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

  const skills = data.skills ?? [];
  const availableSkills = skillCatalog.filter((skill) => !skills.includes(skill.name));

  const toggleLoop = (enabled: boolean) => {
    onChange({ loop: enabled ? { maxIterations: 3, until: 'DONE' } : undefined });
  };
  const addSkill = (skillName: string) => {
    onChange({ skills: [...skills, skillName] });
    setSkillPickerOpen(false);
  };

  return (
    <aside className="flex h-full w-[28rem] shrink-0 flex-col border-l bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Node properties</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${visualFor(data.type).badge}`}
          >
            {visualFor(data.type).label}
          </span>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel">
          <XIcon />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Type</FieldLabel>
            <Select
              value={data.type}
              onValueChange={(v) => onChange({ type: v as BuilderNodeData['type'] })}
            >
              <SelectTrigger className="w-full">
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
            <p className="text-xs text-muted-foreground">
              {NODE_TYPE_DESCRIPTIONS[data.type as keyof typeof NODE_TYPE_DESCRIPTIONS]}
            </p>
          </div>

          <Separator />

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Id</FieldLabel>
            <Input
              value={data.nodeId}
              onChange={(e) => onChange({ nodeId: e.target.value })}
              placeholder="node-id"
            />
          </div>

          {isAgent && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>Provider</FieldLabel>
                  <Select
                    value={data.provider ?? ''}
                    onValueChange={(v) => onChange({ provider: v })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="e.g. codex" />
                    </SelectTrigger>
                    <SelectContent>
                      {providerKeys.map((k) => (
                        <SelectItem key={k} value={k}>{k}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>Model</FieldLabel>
                  <Select
                    value={data.model ?? ''}
                    onValueChange={(v) => onChange({ model: v })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="e.g. gpt-5-codex" />
                    </SelectTrigger>
                    <SelectContent>
                      {modelsFor(data.provider).map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <InstructionsField
                value={data.instructions ?? ''}
                onChange={(v) => onChange({ instructions: v || undefined })}
                commandFiles={commandFiles}
                onEditFile={(path) => setEditFile(path)}
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
                      onClick={() => setSkillPickerOpen(true)}
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
                                      onChange({ skills: skills.filter((s) => s !== skillName) })
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
                    mcpServers={data.mcpServers ?? {}}
                    onChange={(servers) => onChange({ mcpServers: Object.keys(servers).length > 0 ? servers : undefined })}
                  />
                </div>
              </div>
            </div>
          )}

          {isScm && <ScmProperties data={data} onChange={onChange} />}

          {isShell && (
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Script</FieldLabel>
              <Textarea
                value={data.script ?? ''}
                onChange={(e) => onChange({ script: e.target.value })}
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

          {isMessage && <MessageProperties data={data} onChange={onChange} />}
          {isCondition && (
            <ConditionProperties
              data={data}
              onChange={onChange}
              targetOptions={allNodeIds.filter((id) => id !== data.nodeId)}
              referenceOptions={allNodeIds.filter((id) => id !== data.nodeId)}
            />
          )}
          {isHttp && <HttpProperties data={data} onChange={onChange} />}
          {isGraphql && <GraphqlProperties data={data} onChange={onChange} />}

          <Separator />

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Swimlane</FieldLabel>
            <Select
              value={data.swimlane || NONE}
              onValueChange={(v) => onChange({ swimlane: v === NONE ? undefined : v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="No swimlane" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No swimlane</SelectItem>
                {swimlanes.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {supportsRetryPolicy && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Retries"
                  value={data.retries}
                  onChange={(v) => onChange({ retries: v })}
                  placeholder="0"
                />
                <NumberField
                  label="Retry delay (ms)"
                  value={data.retryDelayMs}
                  onChange={(v) => onChange({ retryDelayMs: v })}
                  placeholder="5000"
                />
              </div>
              <NumberField
                label="Timeout (ms)"
                value={data.timeoutMs}
                onChange={(v) => onChange({ timeoutMs: v })}
                placeholder="300000"
              />
            </>
          )}

          <Checkbox
            checked={Boolean(data.continueOnError)}
            onChange={(v) => onChange({ continueOnError: v })}
          >
            Continue on error
          </Checkbox>

          <Checkbox
            checked={Boolean(data.onFailureTransitionTo)}
            onChange={(v) =>
              onChange({
                onFailureTransitionTo: v ? '' : undefined,
              })
            }
          >
            On failure, transition to
          </Checkbox>
          {data.onFailureTransitionTo !== undefined && (
            <div className="ml-6 mt-1">
              <Select
                value={data.onFailureTransitionTo || NONE}
                onValueChange={(v) =>
                  onChange({ onFailureTransitionTo: v === NONE ? '' : v })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select target node..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Select target node...</SelectItem>
                  <SelectItem value="__divider__" disabled className="text-[10px] font-semibold text-muted-foreground">
                    — Nodes —
                  </SelectItem>
                  {allNodeIds
                    .filter((id) => id !== data.nodeId)
                    .map((id) => (
                      <SelectItem key={id} value={id}>
                        {id}
                      </SelectItem>
                    ))}
                  {swimlanes.length > 0 && (
                    <>
                      <SelectItem value="__divider_sw__" disabled className="text-[10px] font-semibold text-muted-foreground">
                        — Swimlanes —
                      </SelectItem>
                      {swimlanes.map((sw) => (
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
                    onChange={toggleLoop}
                  >
                    <span className="font-medium">Loop this node</span>
                  </Checkbox>
                  {data.loop && <LoopEditor loop={data.loop} onChange={(loop) => onChange({ loop })} />}
                </>
              )}
            </>
          )}

        </div>
      </ScrollArea>

      <div className="border-t p-4">
        <Button variant="outline" size="sm" className="w-full text-destructive" onClick={onDelete}>
          <Trash2Icon data-icon="inline-start" />
          Delete node
        </Button>
      </div>

      <Dialog open={skillPickerOpen} onOpenChange={setSkillPickerOpen}>
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
            <Button variant="outline" onClick={() => setSkillPickerOpen(false)}>
              Back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MarkdownFileEditor
        projectId={projectId}
        path={editFile}
        onOpenChange={(open) => {
          if (!open) setEditFile(null);
        }}
      />
    </aside>
  );
}
