import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Project, ProjectSourceKind } from '@orion/models';
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
import { api } from '@/lib/api';
import { PathPicker } from './path-picker';

const SOURCE_LABELS: Record<ProjectSourceKind, string> = {
  remote: 'Remote repository (clone a git URL)',
  local: 'Local repository (existing checkout)',
  workspace: 'Workspace folder (multiple local repos)',
};

const DEFAULT_CONFIG_PATH = '.orion/config.yaml';

export interface ProjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided the dialog edits this project; otherwise it creates a new one. */
  project?: Project | null;
  onSaved: () => void;
}

export function ProjectFormDialog({ open, onOpenChange, project, onSaved }: ProjectFormDialogProps) {
  const editing = Boolean(project);
  const [name, setName] = useState('');
  const [sourceKind, setSourceKind] = useState<ProjectSourceKind>('remote');
  const [repoUrl, setRepoUrl] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [configPath, setConfigPath] = useState(DEFAULT_CONFIG_PATH);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? '');
    setSourceKind(project?.sourceKind ?? 'remote');
    setRepoUrl(project?.repoUrl ?? '');
    setRootPath(project?.rootPath ?? '');
    setDefaultBranch(project?.defaultBranch ?? 'main');
    setConfigPath(project?.configPath ?? DEFAULT_CONFIG_PATH);
  }, [open, project]);

  const isLocal = sourceKind !== 'remote';
  const valid = name.trim() && (isLocal ? rootPath.trim() : repoUrl.trim());

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      const cleanRootPath = rootPath.trim().replace(/(.)\/+$/, '$1');
      const payload = {
        name: name.trim(),
        sourceKind,
        repoUrl: isLocal ? '' : repoUrl.trim(),
        rootPath: isLocal ? cleanRootPath : undefined,
        defaultBranch: defaultBranch.trim() || 'main',
        configPath: configPath.trim() || DEFAULT_CONFIG_PATH,
      };
      if (editing && project) {
        await api.updateProject(project.id, payload);
        toast.success('Project updated');
      } else {
        await api.createProject(payload);
        toast.success('Project created');
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit project' : 'Add project'}</DialogTitle>
          <DialogDescription>
            A project is a repository or a folder of repositories. Its board and
            agents come from <code className="mx-1">{configPath || DEFAULT_CONFIG_PATH}</code> at the
            source root.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Source</Label>
            <Select value={sourceKind} onValueChange={(v) => setSourceKind(v as ProjectSourceKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SOURCE_LABELS) as ProjectSourceKind[]).map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {SOURCE_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLocal ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="project-path">
                {sourceKind === 'workspace' ? 'Workspace folder path' : 'Repository path'}
              </Label>
              <PathPicker
                id="project-path"
                value={rootPath}
                onChange={setRootPath}
                placeholder="Start typing a path, e.g. /Users/you/Development"
              />
              <p className="text-xs text-muted-foreground">
                Browse folders on the server. Type to filter; click a folder to open it.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="project-repo">Repository URL</Label>
              <Input
                id="project-repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="git@github.com:org/repo.git"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="project-branch">Default branch</Label>
            <Input
              id="project-branch"
              value={defaultBranch}
              onChange={(e) => setDefaultBranch(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="project-config-path">Config path</Label>
            <Input
              id="project-config-path"
              value={configPath}
              onChange={(e) => setConfigPath(e.target.value)}
              placeholder={DEFAULT_CONFIG_PATH}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !valid}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
