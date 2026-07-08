import { useEffect, useState } from 'react';
import { FilePenLineIcon, InfoIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type { McpServerConfig, Provider, SkillCatalogEntry, WorkflowNodeType } from '@orion/models';
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
  WORKFLOW_NODE_TYPES,
  type NodeFormModel,
} from './config-model';
import {
  SCM_ACTIONS,
  SCM_ACTION_LABELS,
  type ScmAction,
} from '@/features/workflow-builder/builder-model';

const NODE_TYPE_LABELS: Record<WorkflowNodeType, string> = {
  agent: 'Agent — an AI turn',
  shell: 'Shell — a deterministic script',
  approval: 'Approval — a human gate',
  scm: 'SCM — source-control action',
  workflow: 'Workflow — inline a sub-workflow',
  notify: 'Notify — send a message',
  comment: 'Comment — post on the ticket',
  condition: 'Condition — branch on an expression',
  http: 'HTTP — call an endpoint',
};

const NODE_TYPE_DESCRIPTIONS: Record<WorkflowNodeType, string> = {
  agent: 'Runs an AI agent with a rendered command template. Streams messages and tool calls.',
  shell: 'Runs a deterministic script (tests, a linter, a build). No AI involved.',
  approval: 'Pauses the run in the chosen swimlane until a human approves it.',
  scm: 'Performs a source-control action such as opening a pull request.',
  workflow: 'Inlines a named reusable sub-workflow, flattening its nodes into the DAG.',
  notify: 'Sends a notification (Slack today; Teams and others later) with a rendered message.',
  comment: 'Posts a comment on the run’s ticket in the tracker (Linear today; Jira and others later).',
  condition: 'Evaluates a boolean expression; when false its downstream branch is skipped.',
  http: 'Performs an HTTP request and captures the response for downstream nodes.',
};

const NONE = '__none__';

type NodeDialogView = 'node' | 'skills' | 'mcp-catalog' | 'mcp-custom';

/** Build the default instructions file path for an agent node id. */
function defaultInstructionsPath(id: string): string {
  const trimmed = id.trim();
  return trimmed ? `instructions/${trimmed}.md` : '';
}


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
  const [type, setType] = useState<WorkflowNodeType>('agent');
  const [provider, setProvider] = useState('codex');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [instructions, setInstructions] = useState('');
  const [instructionsTouched, setInstructionsTouched] = useState(false);
  const [action, setAction] = useState('');
  const [script, setScript] = useState('');
  const [swimlane, setSwimlane] = useState('');
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [mcpServers, setMcpServers] = useState<Record<string, McpServerConfig>>({});
  const [view, setView] = useState<NodeDialogView>('node');

  useEffect(() => {
    if (!open) return;
    setView('node');
    setId(node?.id ?? '');
    setType(node?.type ?? 'agent');
    setProvider(node?.provider || 'codex');
    setModel(node?.model ?? '');
    setBaseUrl(node?.baseUrl ?? '');
    setInstructions(node?.instructions ?? '');
    setInstructionsTouched(Boolean(node?.instructions));
    setAction(node?.action ?? '');
    setScript(node?.script ?? '');
    setSwimlane(node?.swimlane ?? '');
    setDependsOn(node?.dependsOn ?? []);
    setSkills(node?.skills ?? []);
    setMcpServers(node?.mcpServers ?? {});
  }, [open, node]);

  // Until the user overrides the instructions path, keep it defaulted to
  // `instructions/<id>.md` so every agent gets a sensible, editable file.
  useEffect(() => {
    if (!open || type !== 'agent' || instructionsTouched) return;
    setInstructions(defaultInstructionsPath(id));
  }, [open, type, id, instructionsTouched]);

  const providerKeys = Array.from(new Set(providers.map((p) => p.key))).sort();
  const modelsFor = (providerKey: string): string[] => {
    const matching = providers
      .filter((p) => p.key === providerKey.trim())
      .flatMap((p) => p.models);
    const pool = matching.length > 0 ? matching : providers.flatMap((p) => p.models);
    return Array.from(new Set(pool)).sort();
  };

  const valid = id.trim().length > 0;

  const handleSave = () => {
    if (!valid) return;
    onSave({
      key: node?.key ?? '',
      id: id.trim(),
      type,
      provider,
      model,
      baseUrl,
      instructions,
      action,
      script,
      swimlane,
      dependsOn,
      skills: skills.length > 0 ? skills : undefined,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      loop: node?.loop,
      config: node?.config,
    });
    onOpenChange(false);
  };

  const addSkill = (skillName: string) => {
    setSkills((prev) => [...prev, skillName]);
    setView('node');
  };

  const addMcpFromCatalog = (entry: McpCatalogEntry) => {
    setMcpServers((prev) => ({ ...prev, [entry.key]: entry.config }));
    setView('node');
  };

  const addMcpCustom = (name: string, config: McpServerConfig) => {
    setMcpServers((prev) => ({ ...prev, [name]: config }));
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

  const toggleDep = (depId: string) => {    setDependsOn((prev) =>
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
            <Select
              value={type}
              onValueChange={(v) => setType(v as WorkflowNodeType)}
            >
              <SelectTrigger id="wn-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKFLOW_NODE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {NODE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {NODE_TYPE_DESCRIPTIONS[type]}
            </p>
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="wn-id">Id</Label>
              <Input
                id="wn-id"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="implement"
              />
            </div>

            {type === 'agent' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wn-provider">Provider</Label>
                  <Select
                    value={provider}
                    onValueChange={(v) => setProvider(v)}
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
                  <Label htmlFor="wn-model">Model</Label>
                  <Select
                    value={model}
                    onValueChange={(v) => setModel(v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="e.g. gpt-5-codex" />
                    </SelectTrigger>
                    <SelectContent>
                      {modelsFor(provider).map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="wn-instructions">Instructions</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="wn-instructions"
                        list="wn-command-files"
                        value={instructions}
                        onChange={(e) => {
                          setInstructions(e.target.value);
                          setInstructionsTouched(true);
                        }}
                        placeholder="instructions/implement.md"
                        spellCheck={false}
                        className="font-mono text-sm"
                      />
                      <datalist id="wn-command-files">
                        {commandFiles.map((file) => (
                          <option key={file} value={file} />
                        ))}
                      </datalist>
                      {onEditFile && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!instructions.trim()}
                          onClick={() => onEditFile(instructions.trim())}
                          aria-label="Edit instructions file"
                          title="Edit this markdown file"
                        >
                          <FilePenLineIcon className="size-3.5" /> Edit file
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Path to a markdown instructions file relative to <code>.orion/</code> (e.g.{' '}
                      <code>instructions/implement.md</code>). Defaults to{' '}
                      <code>instructions/&lt;id&gt;.md</code>. Use <strong>Edit file</strong> to write
                      it. Supports $VARIABLE substitution.
                    </p>
                  </div>
                </div>

                {skillCatalog.length > 0 && (
                  <div className="sm:col-span-2">
                    <Separator />
                    <div className="mt-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-sm font-medium">Skills</span>
                          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
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
                                      <span className="font-mono text-sm font-medium">
                                        {skillName}
                                      </span>
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
                                          setSkills((prev) => prev.filter((s) => s !== skillName))
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
                  </div>
                )}

                <div className="sm:col-span-2">
                  <Separator />
                  <div className="mt-3 flex flex-col gap-2">
                    <span className="text-sm font-medium">MCP Servers</span>
                    <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
                      MCP servers give the agent access to external tools.
                    </p>
                    <McpServersEditor
                      mcpServers={mcpServers}
                      onChange={(servers) => setMcpServers(servers)}
                      onRequestAddCatalog={() => setView('mcp-catalog')}
                      onRequestAddCustom={() => setView('mcp-custom')}
                    />
                  </div>
                </div>
              </>
            )}

            {type === 'scm' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wn-action">Action</Label>
                <Select
                  value={action || undefined}
                  onValueChange={(v) => setAction(v)}
                >
                  <SelectTrigger id="wn-action" className="w-full">
                    <SelectValue placeholder="Select an action" />
                  </SelectTrigger>
                  <SelectContent>
                    {SCM_ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {SCM_ACTION_LABELS[a] ?? a}
                      </SelectItem>
                    ))}
                    {action && !SCM_ACTIONS.includes(action as ScmAction) && (
                      <SelectItem value={action}>{action}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {type === 'shell' && (
              <div className="sm:col-span-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wn-script">Script</Label>
                  <Textarea
                    id="wn-script"
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    placeholder="npm test"
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wn-swimlane">Swimlane</Label>
            <Select
              value={swimlane || NONE}
              onValueChange={(v) => setSwimlane(v === NONE ? '' : v)}
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
                    <button
                      key={other.key}
                      type="button"
                      onClick={() => toggleDep(other.id)}
                    >
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
        <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add skill</DialogTitle>
            <DialogDescription>
              Select a skill to enable for this agent node.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto flex flex-col gap-2">
            {availableSkills.map((skill) => (
              <button
                key={skill.name}
                type="button"
                onClick={() => addSkill(skill.name)}
                className="text-left rounded-md border p-3 hover:border-primary/50 transition-colors cursor-pointer hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{skill.name}</span>
                  {skill.source === 'builtin' && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      built-in
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{skill.description}</p>
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
        <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add MCP Server</DialogTitle>
            <DialogDescription>
              Select a pre-configured MCP server from the catalog.
            </DialogDescription>
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
            <DialogDescription>
              Configure a stdio or HTTP MCP server.
            </DialogDescription>
          </DialogHeader>
          <McpCustomForm onAdd={addMcpCustom} onCancel={() => setView('node')} cancelLabel="Back" />
        </DialogContent>
      )}
    </Dialog>
  );
}
