import { useMemo, useState } from 'react';
import { XIcon, Trash2Icon, FilePenLineIcon, InfoIcon } from 'lucide-react';
import type {
  Provider,
  RetrievalConfig,
  SkillCatalogEntry,
  WorkflowNodeType,
} from '@orion/models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MarkdownFileEditor } from '@/features/projects/markdown-file-editor';
import { NODE_TYPES, type BuilderNode, type BuilderNodeData } from './builder-model';
import { NODE_VISUALS } from './workflow-node';
import { McpServersEditor } from '@/features/settings/mcp-servers-editor';
import { FieldLabel, Checkbox, NumberField } from './node-properties/fields';
import { LoopEditor } from './node-properties/loop-editor';
import { MatrixEditor } from './node-properties/matrix-editor';
import { StructuredOutputEditor } from './node-properties/structured-output-editor';
import { ScmProperties } from './node-properties/scm-properties';
import { NotifyProperties } from './node-properties/notify-properties';
import { CommentProperties } from './node-properties/comment-properties';
import { ConditionProperties } from './node-properties/condition-properties';
import { HttpProperties } from './node-properties/http-properties';

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
  onChange,
  onDelete,
  onClose,
}: NodePropertiesPanelProps) {
  const [editFile, setEditFile] = useState<string | null>(null);

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
  const isNotify = data.type === 'notify';
  const isComment = data.type === 'comment';
  const isCondition = data.type === 'condition';
  const isHttp = data.type === 'http';
  const canLoop = isAgent || isShell;

  const toggleLoop = (enabled: boolean) => {
    onChange({ loop: enabled ? { maxIterations: 3, until: 'DONE' } : undefined });
  };
  const toggleMatrix = (enabled: boolean) => {
    onChange({ matrix: enabled ? { items: [] } : undefined });
  };
  const toggleStructured = (enabled: boolean) => {
    onChange({ structuredOutput: enabled ? { schema: {}, required: [] } : undefined });
  };
  const toggleRetrieval = (enabled: boolean) => {
    onChange({ retrieval: enabled ? {} : undefined });
  };
  const patchRetrieval = (patch: Partial<RetrievalConfig>) => {
    onChange({ retrieval: { ...data.retrieval, ...patch } });
  };

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-card">
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
            <FieldLabel>Id</FieldLabel>
            <Input
              value={data.nodeId}
              onChange={(e) => onChange({ nodeId: e.target.value })}
              placeholder="node-id"
            />
          </div>

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
                    {NODE_VISUALS[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isAgent && (
            <>
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
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Instructions</FieldLabel>
                <Textarea
                  value={data.instructions ?? ''}
                  onChange={(e) => onChange({ instructions: e.target.value || undefined })}
                  placeholder="commands/implement.md or inline instructions…"
                  className="min-h-24 text-sm"
                  spellCheck={false}
                />
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-[11px] text-muted-foreground">
                    A command file path or inline text template. Supports $VARIABLE substitution.
                  </p>
                  {data.instructions?.trim() && !data.instructions.includes('\n') && (
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => setEditFile(data.instructions?.trim() ?? null)}
                      title="Edit this markdown file"
                      aria-label="Edit instructions file"
                    >
                      <FilePenLineIcon className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              <Separator />
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">Skills</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground cursor-help"><InfoIcon className="size-3.5" /></span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-64">
                      Skills are instruction bundles that guide how the agent works. They are copied into the agent's worktree before each run.
                    </TooltipContent>
                  </Tooltip>
                </div>
                {skillCatalog.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No skills available. Install skills via the project settings.</p>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto rounded-md border p-2">
                    {skillCatalog.map((skill) => {
                      const active = (data.skills ?? []).includes(skill.name);
                      return (
                        <label
                          key={skill.name}
                          className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer hover:bg-muted/50 text-sm ${
                            active ? 'bg-primary/10' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="size-4 accent-primary shrink-0"
                            checked={active}
                            onChange={(e) => {
                              const current = data.skills ?? [];
                              const next = e.target.checked
                                ? [...current, skill.name]
                                : current.filter((s) => s !== skill.name);
                              onChange({ skills: next });
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{skill.name}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{skill.description}</div>
                          </div>
                          {skill.source === 'builtin' && (
                            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">built-in</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
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

          {isNotify && <NotifyProperties data={data} onChange={onChange} />}
          {isComment && <CommentProperties data={data} onChange={onChange} />}
          {isCondition && <ConditionProperties data={data} onChange={onChange} />}
          {isHttp && <HttpProperties data={data} onChange={onChange} />}

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

          {!isCondition && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <FieldLabel>Condition (when)</FieldLabel>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground cursor-help"><InfoIcon className="size-3" /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    A condition expression evaluated against upstream node outputs. When <code>false</code>, this node and its exclusive branch are skipped.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                value={data.when ?? ''}
                onChange={(e) => onChange({ when: e.target.value })}
                placeholder="nodes.review.data.approved == true"
              />
              <p className="text-[11px] text-muted-foreground">
                When false, this node and its exclusive branch are skipped.
              </p>
            </div>
          )}

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

          <Checkbox
            checked={Boolean(data.continueOnError)}
            onChange={(v) => onChange({ continueOnError: v })}
          >
            Continue on error
          </Checkbox>

          {canLoop && (
            <>
              <Separator />
              <div className="flex items-center gap-1.5">
                <Checkbox
                  checked={Boolean(data.loop)}
                  onChange={toggleLoop}
                >
                  <span className="font-medium">Loop this node</span>
                </Checkbox>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground cursor-help"><InfoIcon className="size-3.5" /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    Run this node repeatedly in a loop until a stop phrase appears in the output, or the max iterations are reached.
                  </TooltipContent>
                </Tooltip>
              </div>
              {data.loop && <LoopEditor loop={data.loop} onChange={(loop) => onChange({ loop })} />}

              <div className="flex items-center gap-1.5">
                <Checkbox checked={Boolean(data.matrix)} onChange={toggleMatrix}>
                  <span className="font-medium">Matrix fan-out</span>
                </Checkbox>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground cursor-help"><InfoIcon className="size-3.5" /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    Run this node once for each item in a list. Dependents downstream are collected and merged. Cannot be combined with a loop.
                  </TooltipContent>
                </Tooltip>
              </div>
              {data.matrix && (
                <MatrixEditor matrix={data.matrix} onChange={(matrix) => onChange({ matrix })} />
              )}
            </>
          )}

          {isAgent && (
            <>
              <Separator />
              <div className="flex items-center gap-1.5">
                <Checkbox checked={Boolean(data.structuredOutput)} onChange={toggleStructured}>
                  <span className="font-medium">Structured output</span>
                </Checkbox>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground cursor-help"><InfoIcon className="size-3.5" /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    Constrain the agent to return JSON matching the schema you define. Useful for programmatic consumption by downstream nodes.
                  </TooltipContent>
                </Tooltip>
              </div>
              {data.structuredOutput && (
                <StructuredOutputEditor
                  value={data.structuredOutput}
                  onChange={(v) => onChange({ structuredOutput: v })}
                />
              )}

              <div className="flex items-center gap-1.5">
                <Checkbox checked={Boolean(data.retrieval)} onChange={toggleRetrieval}>
                  <span className="font-medium">Codebase retrieval (RAG)</span>
                </Checkbox>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground cursor-help"><InfoIcon className="size-3.5" /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    Augment the agent's context with relevant code snippets from the project's indexed codebase before it runs.
                  </TooltipContent>
                </Tooltip>
              </div>
              {data.retrieval && (
                <div className="flex flex-col gap-3 rounded-md border p-3">
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>Query (optional)</FieldLabel>
                    <Input
                      value={data.retrieval.query ?? ''}
                      onChange={(e) => patchRetrieval({ query: e.target.value || undefined })}
                      placeholder="defaults to ticket title + description"
                    />
                  </div>
                  <NumberField
                    label="Top K (max 20)"
                    value={data.retrieval.topK}
                    onChange={(v) => patchRetrieval({ topK: v })}
                    placeholder="10"
                  />
                </div>
              )}

              <Separator />
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">MCP Servers</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground cursor-help"><InfoIcon className="size-3.5" /></span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-72">
                      Model Context Protocol servers give the agent access to external tools. Add a server from the catalog or configure a custom one. Node-level servers are merged with project-wide servers.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <McpServersEditor
                  mcpServers={data.mcpServers ?? {}}
                  onChange={(servers) => onChange({ mcpServers: Object.keys(servers).length > 0 ? servers : undefined })}
                />
              </div>
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
