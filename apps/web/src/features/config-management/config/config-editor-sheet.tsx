import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { ArrowLeftIcon, CodeIcon, FileWarningIcon, LayoutListIcon, SaveIcon, SparklesIcon, WorkflowIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Project, Provider, SkillCatalogEntry } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { api, type WorkflowTemplateDetail } from '@/lib/api';
import { ConfigForm } from './config-form';
import { MarkdownFileEditor } from '../shared/markdown-file-editor';
import { WorkflowTemplateDialog } from '../shared/workflow-template-dialog';
import {
  applyWorkflowTemplate,
  CONFIG_TEMPLATE_MODEL,
  modelToYaml,
  parseConfigToModel,
  validateModel,
  type ConfigFormModel,
} from './config-model';

type Mode = 'form' | 'yaml';

export interface ConfigEditorSheetProps {
  project: Project | null;
  onClose: () => void;
  onSaved?: () => void;
}

export function ConfigEditorSheet({ project, onClose, onSaved }: ConfigEditorSheetProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('form');
  const [model, setModel] = useState<ConfigFormModel>(CONFIG_TEMPLATE_MODEL);
  const [content, setContent] = useState('');
  const [configPath, setConfigPath] = useState('.orion/config.yaml');
  const [exists, setExists] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogEntry[]>([]);
  const [commandFiles, setCommandFiles] = useState<string[]>([]);

  useEffect(() => {
    if (!project) return;
    setError(null);
    setMode('form');
    setLoading(true);
    api
      .getRawConfig(project.id)
      .then((res) => {
        setConfigPath(res.configPath);
        setExists(res.content !== null);
        if (res.content) {
          setContent(res.content);
          try {
            setModel(parseConfigToModel(res.content));
            setMode('form');
          } catch {
            setMode('yaml');
          }
        } else {
          const template = CONFIG_TEMPLATE_MODEL();
          setModel(template);
          setContent(modelToYaml(template));
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [project]);

  useEffect(() => {
    if (!project) return;
    setProviders([]);
    setSkillCatalog([]);
    setCommandFiles([]);
    api.listProviders().then(setProviders).catch(() => setProviders([]));
    api.listSkills(project.id).then((res) => setSkillCatalog(res.skills)).catch(() => setSkillCatalog([]));
    api.listCommandFiles(project.id).then((res) => setCommandFiles(res.files)).catch(() => setCommandFiles([]));
  }, [project]);

  const issues = useMemo(() => (mode === 'form' ? validateModel(model) : []), [mode, model]);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setError(null);
    if (next === 'yaml') {
      setContent(modelToYaml(model));
      setMode('yaml');
    } else {
      try {
        setModel(parseConfigToModel(content));
        setMode('form');
      } catch (e) {
        toast.error('Cannot parse YAML into the form');
        setError((e as Error).message);
      }
    }
  };

  const save = async () => {
    if (!project) return;
    const yaml = mode === 'form' ? modelToYaml(model) : content;
    setSaving(true);
    setError(null);
    try {
      await api.saveRawConfig(project.id, yaml);
      setContent(yaml);
      setExists(true);
      toast.success('Configuration saved');
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
      toast.error('Configuration is invalid');
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = (detail: WorkflowTemplateDetail) => {
    if (!project) return;
    const currentYaml = mode === 'form' ? modelToYaml(model) : content;
    let merged = applyWorkflowTemplate(currentYaml, {
      yaml: detail.yaml,
      suggestedSwimlanes: detail.suggestedSwimlanes,
    });
    try {
      const parsed = yamlParse(merged) as Record<string, unknown>;
      const wf = (parsed?.workflow ?? {}) as Record<string, unknown>;
      if (Array.isArray(wf.nodes)) {
        for (const node of wf.nodes) {
          if (!node || typeof node !== 'object') continue;
          const n = node as Record<string, unknown>;
          if (n.type !== 'agent') continue;
          const id = String(n.id ?? '');
          if (!id) continue;
          const instructions = n.instructions;
          if (instructions && typeof instructions === 'string' && instructions.trim()) {
            const inline = instructions.trim();
            if (!inline.includes('\n') && (inline.startsWith('instructions/') || inline.endsWith('.md'))) continue;
            const filePath = `instructions/${id}.md`;
            api.saveCommandFile(project.id, filePath, inline).catch(() => undefined);
            n.instructions = filePath;
          } else {
            n.instructions = `instructions/${id}.md`;
          }
        }
        parsed.workflow = wf;
        merged = yamlStringify(parsed, { indent: 2, lineWidth: 0 });
      }
    } catch {
      // Proceed with the original merged YAML if post-processing fails
    }
    setContent(merged);
    setMode('yaml');
    setError(null);
    toast.success(`Inserted "${detail.title}" — review and save`);
  };

  const canSave =
    !loading && !saving && (mode === 'form' ? issues.length === 0 : Boolean(content.trim()));

  if (!project) return null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b bg-card px-4 py-3">
        <Button variant="ghost" size="icon" onClick={onClose}>
          <ArrowLeftIcon />
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Orion configuration</h2>
          <p className="text-sm text-muted-foreground">
            Editing <code>{configPath}</code>
            {!exists && ' — file does not exist yet, starting from a template'}
          </p>
        </div>
      </header>

      <div className="flex items-center justify-between gap-2 border-b bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex p-0.5">
            <Button
              variant={mode === 'form' ? 'secondary' : 'ghost'}
              size="sm"
              className={cn('gap-1.5', mode !== 'form' && 'text-muted-foreground')}
              onClick={() => switchMode('form')}
              disabled={loading}
            >
              <LayoutListIcon />
              Form
            </Button>
            <Button
              variant={mode === 'yaml' ? 'secondary' : 'ghost'}
              size="sm"
              className={cn('gap-1.5', mode !== 'yaml' && 'text-muted-foreground')}
              onClick={() => switchMode('yaml')}
              disabled={loading}
            >
              <CodeIcon />
              YAML
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => navigate(`/projects/${project.id}/builder`)}
            disabled={loading}
          >
            <WorkflowIcon />
            Open visual builder
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setTemplatePickerOpen(true)}
          disabled={loading || saving}
        >
          <SparklesIcon />
          Start from a template
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <FileWarningIcon className="mt-0.5 size-4 shrink-0" />
            <span className="whitespace-pre-wrap">{error}</span>
          </div>
        )}

        {mode === 'form' && issues.length > 0 && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            <p className="font-medium">Resolve before saving:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : mode === 'form' ? (
          <ConfigForm
            model={model}
            onChange={setModel}
            disabled={saving}
            providers={providers}
            onEditFile={setEditingFile}
            commandFiles={commandFiles}
            skillCatalog={skillCatalog}
          />
        ) : (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={saving}
            spellCheck={false}
            className="min-h-96 flex-1 resize-none font-mono text-xs"
          />
        )}
      </div>

      <footer className="flex items-center gap-2 border-t bg-card px-4 py-3">
        <Button onClick={save} disabled={!canSave}>
          <SaveIcon data-icon="inline-start" />
          Save
        </Button>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </footer>

      <MarkdownFileEditor
        projectId={project.id}
        path={editingFile}
        onOpenChange={(open) => !open && setEditingFile(null)}
        onSaved={(path) =>
          setCommandFiles((prev) => (prev.includes(path) ? prev : [...prev, path].sort()))
        }
      />

      <WorkflowTemplateDialog
        open={templatePickerOpen}
        onOpenChange={setTemplatePickerOpen}
        onApply={applyTemplate}
      />
    </div>
  );
}
