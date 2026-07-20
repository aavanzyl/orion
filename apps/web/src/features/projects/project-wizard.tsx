import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ProjectSourceKind, Provider, WorkflowTemplateSummary } from '@orion/models';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api, type WorkflowTemplateDetail } from '@/lib/api';
import { PathPicker } from './path-picker';
import { MultiPathPicker } from './multi-path-picker';

const SOURCE_LABELS: Record<ProjectSourceKind, string> = {
  remote: 'Remote repository (clone a git URL)',
  local: 'Local repository (existing checkout)',
  workspace: 'Workspace folder (multiple local repos)',
};

const TOTAL_STEPS = 4;

const STEP_LABELS = ['Basics', 'Workflow', 'Agent', 'Review'];

const DEFAULT_PROVIDER = 'default';
const DEFAULT_MODEL = 'default';

export interface ProjectWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function ProjectWizard({ open, onOpenChange, onSaved }: ProjectWizardProps) {
  const [step, setStep] = useState(0);

  const [name, setName] = useState('');
  const [sourceKind, setSourceKind] = useState<ProjectSourceKind>('remote');
  const [repoUrl, setRepoUrl] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [paths, setPaths] = useState<string[]>([]);
  const [defaultBranch, setDefaultBranch] = useState('main');

  const [selectedTemplate, setSelectedTemplate] = useState('default');
  const [templates, setTemplates] = useState<WorkflowTemplateSummary[]>([]);
  const [templateDetail, setTemplateDetail] = useState<WorkflowTemplateDetail | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [providers, setProviders] = useState<Provider[]>([]);

  const [provider, setProvider] = useState(DEFAULT_PROVIDER);
  const [model, setModel] = useState(DEFAULT_MODEL);

  const [submitting, setSubmitting] = useState(false);

  const isLocal = sourceKind !== 'remote';

  useEffect(() => {
    if (!open) {
      setStep(0);
      setName('');
      setSourceKind('remote');
      setRepoUrl('');
      setRootPath('');
      setPaths([]);
      setDefaultBranch('main');
      setSelectedTemplate('default');
      setProviders([]);
      setProvider(DEFAULT_PROVIDER);
      setModel(DEFAULT_MODEL);
      return;
    }
    api
      .listWorkflowTemplates()
      .then((list) => {
        setTemplates(list);
        setSelectedTemplate(list[0]?.name ?? 'default');
      })
      .catch(() => {
        // Templates are non-critical; proceed with whatever loaded.
      })
      .finally(() => setTemplatesLoading(false));
    api
      .listProviders()
      .then((list) => {
        setProviders(list);
        if (list.length > 0) {
          const first = list[0];
          setProvider(first.harness || 'default');
          const models = [...new Set(list.flatMap((p) => p.models))];
          setModel(models[0] || 'default');
        }
      })
      .catch(() => {
        // Providers are non-critical; proceed with defaults.
      });
  }, [open]);

  useEffect(() => {
    if (!selectedTemplate) return;
    api.getWorkflowTemplate(selectedTemplate).then(setTemplateDetail).catch(() => {
      // Template detail fetch is non-critical.
    });
  }, [selectedTemplate]);

  const harnessOptions = useMemo(() => {
    if (providers.length === 0) return ['default'];
    const harnesses = [...new Set(
      providers.map((p) => p.harness).filter((h): h is string => !!h),
    )];
    return harnesses.length > 0 ? harnesses : ['default'];
  }, [providers]);

  const modelOptions = useMemo(() => {
    if (providers.length === 0) return ['default'];
    const filtered = providers.filter((p) => p.harness === provider);
    const models = [...new Set(filtered.flatMap((p) => p.models))];
    return models.length > 0 ? models : ['default'];
  }, [providers, provider]);

  const handleProviderChange = (value: string) => {
    setProvider(value);
    const filtered = providers.filter((p) => p.harness === value);
    const models = [...new Set(filtered.flatMap((p) => p.models))];
    setModel(models[0] || 'default');
  };

  const generatedYaml = useMemo(() => {
    if (!templateDetail) return '';
    const workflowYaml = templateDetail.yaml;
    const modifiedYaml = workflowYaml
      .replace(/provider:\s*codex/g, `provider: ${provider}`)
      .replace(/model:\s*gpt-5-codex/g, `model: ${model}`);
    const swimlanes = templateDetail.suggestedSwimlanes;
    const swimlanesYaml =
      swimlanes.length > 0
        ? `[${swimlanes.join(', ')}]`
        : '[backlog, in_progress, review, done]';
    return [
      `project:`,
      `  name: ${name || '<name>'}`,
      `  defaultBranch: ${defaultBranch || 'main'}`,
      ``,
      `board:`,
      `  swimlanes: ${swimlanesYaml}`,
      ``,
      modifiedYaml,
    ].join('\n');
  }, [templateDetail, provider, model, name, defaultBranch]);

  const validStep1 =
    name.trim() && (isLocal
      ? (sourceKind === 'workspace'
          ? paths.filter((p) => p.trim()).length > 0
          : rootPath.trim())
      : repoUrl.trim());

  const stepBack = () => setStep((prev) => Math.max(0, prev - 1));
  const stepNext = () => {
    if (step === 0 && !validStep1) return;
    setStep((prev) => Math.min(TOTAL_STEPS - 1, prev + 1));
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const cleanRootPath = rootPath.trim().replace(/(.)\/+$/, '$1');
      const cleanPaths = paths
        .map((p) => p.trim().replace(/(.)\/+$/, '$1'))
        .filter((p) => p.length > 0);
      await api.createProject({
        name: name.trim(),
        sourceKind,
        repoUrl: isLocal ? '' : repoUrl.trim(),
        rootPath: isLocal && sourceKind !== 'workspace' ? cleanRootPath : undefined,
        paths: sourceKind === 'workspace' ? cleanPaths : undefined,
        defaultBranch: defaultBranch.trim() || 'main',
        configPath: '.orion/config.yaml',
        configYaml: generatedYaml,
      } as Parameters<typeof api.createProject>[0]);
      toast.success('Project created');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const templateTagColors: Record<string, string> = {
    general: 'default',
    recommended: 'default',
    review: 'secondary',
    bugfix: 'destructive',
    feature: 'default',
    testing: 'secondary',
    refactor: 'secondary',
    quality: 'default',
    fast: 'default',
    docs: 'secondary',
    maintenance: 'secondary',
    parallel: 'secondary',
    iterative: 'secondary',
    research: 'secondary',
    triage: 'secondary',
    skills: 'secondary',
    rag: 'secondary',
    notifications: 'secondary',
    matrix: 'secondary',
    pr: 'secondary',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
          <DialogDescription>
            Set up a project with a workflow in a few steps.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                  i === step
                    ? 'bg-primary text-primary-foreground'
                    : i < step
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {i < step ? '\u2713' : i + 1}
              </div>
              <span
                className={`text-sm ${i <= step ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {label}
              </span>
              {i < STEP_LABELS.length - 1 && (
                <div className="mx-1 h-px w-6 bg-border" />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Basics */}
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="wiz-name">Project name</Label>
              <Input
                id="wiz-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-project"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Source</Label>
              <Select
                value={sourceKind}
                onValueChange={(v) => setSourceKind(v as ProjectSourceKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SOURCE_LABELS) as ProjectSourceKind[]).map(
                    (kind) => (
                      <SelectItem key={kind} value={kind}>
                        {SOURCE_LABELS[kind]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            {isLocal ? (
              sourceKind === 'workspace' ? (
                <div className="flex flex-col gap-2">
                  <Label>Workspace folders</Label>
                  <MultiPathPicker
                    paths={paths}
                    onChange={setPaths}
                    placeholder="Start typing a path, e.g. /Users/you/Development"
                  />
                  <p className="text-xs text-muted-foreground">
                    Add one or more folders. Each becomes a repo in your workspace.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="wiz-path">Repository path</Label>
                  <PathPicker
                    id="wiz-path"
                    value={rootPath}
                    onChange={setRootPath}
                    placeholder="Start typing a path, e.g. /Users/you/Development"
                  />
                  <p className="text-xs text-muted-foreground">
                    Browse folders on the server.
                  </p>
                </div>
              )
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="wiz-repo">Repository URL</Label>
                <Input
                  id="wiz-repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="git@github.com:org/repo.git"
                />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="wiz-branch">Default branch</Label>
              <Input
                id="wiz-branch"
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Step 2: Workflow template */}
        {step === 1 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Choose a workflow template. You can customise it later.
            </p>
            {templatesLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <ScrollArea className="h-[320px]">
                <div className="grid grid-cols-1 gap-2 pr-2">
                  {templates.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => setSelectedTemplate(t.name)}
                      className={`cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                        selectedTemplate === t.name
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{t.title}</span>
                        {t.tags?.map((tag) => (
                          <Badge
                            key={tag}
                            variant={
                              (templateTagColors[tag] as 'default' | 'secondary' | 'destructive') ?? 'secondary'
                            }
                            className="text-[10px]"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t.description}
                      </p>
                      <div className="mt-2 flex gap-2 text-[10px] text-muted-foreground">
                        <span>{t.nodeCount} nodes</span>
                        <span>\u00b7</span>
                        <span>{t.nodeTypes.join(', ')}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        {/* Step 3: Agent configuration */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Configure the AI provider and model for agent nodes. These values
              are applied to every agent in the selected workflow.
            </p>

            <div className="flex flex-col gap-2">
              <Label htmlFor="wiz-provider">Provider (harness key)</Label>
              <Select value={provider} onValueChange={handleProviderChange}>
                <SelectTrigger id="wiz-provider">
                  <SelectValue placeholder="default" />
                </SelectTrigger>
                <SelectContent>
                  {harnessOptions.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The adapter key, e.g. <code>codex</code>.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="wiz-model">Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger id="wiz-model">
                  <SelectValue placeholder="default" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Model identifier, e.g. <code>gpt-5-codex</code>.
              </p>
            </div>
          </div>
        )}

        {/* Step 4: Review & create */}
        {step === 3 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Review the generated <code>.orion/config.yaml</code> before
              creating the project.
            </p>
            <ScrollArea className="h-[320px] rounded-md border bg-muted/30 p-3">
              <pre className="text-xs font-mono whitespace-pre">
                {generatedYaml || 'Loading...'}
              </pre>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" onClick={stepBack}>
                Back
              </Button>
            )}
            {step < TOTAL_STEPS - 1 ? (
              <Button onClick={stepNext} disabled={step === 0 && !validStep1}>
                Next
              </Button>
            ) : (
              <Button onClick={submit} disabled={submitting || !validStep1}>
                {submitting ? 'Creating...' : 'Create Project'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
