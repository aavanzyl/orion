import { useCallback, useEffect, useMemo, useState } from 'react';
import { LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@orion/models';
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
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  api,
  type BoardSyncDirection,
  type RemoteContainer,
  type RemoteState,
} from '@/lib/api';

export interface BoardSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Projects selectable when adding a new sync (already-connected ones excluded). */
  availableProjects: Project[];
  /** When set, the dialog edits this project's existing connection. */
  editProject: Project | null;
  onSaved: () => void;
}

type ProviderKey = 'linear' | 'jira' | 'trello';

interface ProviderMeta {
  label: string;
  /** Label for the primary secret field. */
  secretLabel: string;
  secretPlaceholder: string;
  /** Noun for the remote container (team/project/board). */
  containerLabel: string;
  /** Extra non-secret config fields to collect. */
  configFields: { key: string; label: string; placeholder: string }[];
}

const PROVIDERS: Record<ProviderKey, ProviderMeta> = {
  linear: {
    label: 'Linear',
    secretLabel: 'Linear API key',
    secretPlaceholder: 'lin_api_...',
    containerLabel: 'Team',
    configFields: [],
  },
  jira: {
    label: 'Jira',
    secretLabel: 'Jira API token',
    secretPlaceholder: 'ATATT...',
    containerLabel: 'Project',
    configFields: [
      { key: 'baseUrl', label: 'Site URL', placeholder: 'https://your-domain.atlassian.net' },
      { key: 'email', label: 'Account email', placeholder: 'you@company.com' },
    ],
  },
  trello: {
    label: 'Trello',
    secretLabel: 'Trello token',
    secretPlaceholder: 'ATTA...',
    containerLabel: 'Board',
    configFields: [{ key: 'key', label: 'API key', placeholder: 'Trello API key' }],
  },
};

const DIRECTIONS: { value: BoardSyncDirection; label: string }[] = [
  { value: 'both', label: 'Two-way (pull + push)' },
  { value: 'pull', label: 'Pull only (remote → Orion)' },
  { value: 'push', label: 'Push only (Orion → remote)' },
];

export function BoardSyncDialog({
  open,
  onOpenChange,
  availableProjects,
  editProject,
  onSaved,
}: BoardSyncDialogProps) {
  const isEdit = editProject != null;
  const [projectId, setProjectId] = useState('');
  const [provider, setProvider] = useState<ProviderKey>('linear');
  const [apiKey, setApiKey] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [containers, setContainers] = useState<RemoteContainer[]>([]);
  const [teamId, setTeamId] = useState('');
  const [states, setStates] = useState<RemoteState[]>([]);
  const [stateMap, setStateMap] = useState<Record<string, string>>({});
  const [swimlanes, setSwimlanes] = useState<string[]>([]);
  const [direction, setDirection] = useState<BoardSyncDirection>('both');
  const [autoPush, setAutoPush] = useState(true);
  const [importNew, setImportNew] = useState(true);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);

  const meta = PROVIDERS[provider];
  /** A fresh secret+config is required only when there's no stored key. */
  const configReady = useMemo(
    () => meta.configFields.every((f) => (config[f.key] ?? '').trim().length > 0),
    [meta, config],
  );
  const canProbe = (hasStoredKey || apiKey.trim().length > 0) && (configReady || hasStoredKey);

  const loadSwimlanes = useCallback(async (id: string, preserve: boolean) => {
    try {
      const cfg = await api.getProjectConfig(id);
      setSwimlanes(cfg.board.swimlanes);
      if (!preserve) {
        setStateMap(Object.fromEntries(cfg.board.swimlanes.map((c) => [c, ''])));
      }
    } catch {
      setSwimlanes([]);
    }
  }, []);

  const fetchStates = useCallback(
    async (id: string, prov: ProviderKey, key: string, tId: string, cfg: Record<string, string>) => {
      if (!id || !tId) return;
      try {
        const result = await api.listBoardStates(id, tId, {
          provider: prov,
          apiKey: key || undefined,
          config: cfg,
        });
        setStates(result);
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    setContainers([]);
    setStates([]);
    if (editProject) {
      setProjectId(editProject.id);
      setFetching(true);
      Promise.all([api.getBoardConnection(editProject.id), api.getProjectConfig(editProject.id)])
        .then(async ([conn, cfg]) => {
          const prov = (conn.provider as ProviderKey) ?? 'linear';
          setProvider(prov);
          setSwimlanes(cfg.board.swimlanes);
          setTeamId(conn.teamId ?? '');
          setConfig(conn.config ?? {});
          setStateMap(conn.stateMap ?? {});
          setEnabled(conn.enabled ?? true);
          setDirection(conn.direction ?? 'both');
          setAutoPush(conn.autoPush ?? true);
          setImportNew(conn.importNew ?? true);
          setUpdateExisting(conn.updateExisting ?? true);
          setIntervalMinutes(conn.syncIntervalMs ? String(Math.round(conn.syncIntervalMs / 60000)) : '');
          setApiKey('');
          setHasStoredKey(Boolean(conn.hasApiKey));
          if (conn.hasApiKey) {
            const fetched = await api
              .listBoardContainers(editProject.id, { provider: prov, config: conn.config })
              .catch(() => [] as RemoteContainer[]);
            setContainers(fetched);
            if (conn.teamId) {
              await fetchStates(editProject.id, prov, '', conn.teamId, conn.config ?? {});
            }
          }
        })
        .catch((e) => toast.error((e as Error).message))
        .finally(() => setFetching(false));
    } else {
      const first = availableProjects[0]?.id ?? '';
      setProjectId(first);
      setProvider('linear');
      setApiKey('');
      setHasStoredKey(false);
      setConfig({});
      setTeamId('');
      setStateMap({});
      setDirection('both');
      setAutoPush(true);
      setImportNew(true);
      setUpdateExisting(true);
      setIntervalMinutes('');
      setEnabled(true);
      setSwimlanes([]);
      if (first) loadSwimlanes(first, false);
    }
  }, [open, editProject, availableProjects, loadSwimlanes, fetchStates]);

  const handleProjectChange = (id: string) => {
    setProjectId(id);
    setContainers([]);
    setStates([]);
    setTeamId('');
    loadSwimlanes(id, false);
  };

  const fetchContainers = async () => {
    if (!projectId || !canProbe) return;
    setFetching(true);
    try {
      const result = await api.listBoardContainers(projectId, {
        provider,
        apiKey: apiKey || undefined,
        config,
      });
      setContainers(result);
      toast.success(`Found ${result.length} ${meta.containerLabel.toLowerCase()}(s)`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFetching(false);
    }
  };

  const handleContainerChange = (v: string) => {
    setTeamId(v);
    fetchStates(projectId, provider, apiKey, v, config);
  };

  const save = async () => {
    if (!projectId || !teamId) return;
    setSaving(true);
    try {
      const filteredMap: Record<string, string> = {};
      for (const [col, stateId] of Object.entries(stateMap)) {
        if (stateId) filteredMap[col] = stateId;
      }
      const minutes = Number(intervalMinutes);
      await api.saveBoardConnection(projectId, {
        provider,
        apiKey: apiKey || undefined,
        teamId,
        config,
        stateMap: filteredMap,
        direction,
        autoPush,
        importNew,
        updateExisting,
        syncIntervalMs:
          intervalMinutes.trim() && Number.isFinite(minutes) && minutes > 0
            ? Math.round(minutes * 60000)
            : null,
        enabled,
      });
      toast.success(isEdit ? 'Board connection updated' : 'Board connection saved');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit board sync' : 'Add board sync'}</DialogTitle>
          <DialogDescription>
            Connect an external task board to a project. Swimlane changes can push upstream and
            remote updates pull back on a configurable cadence.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="board-sync-project">Project</Label>
            {isEdit ? (
              <Input id="board-sync-project" value={editProject?.name ?? ''} disabled />
            ) : (
              <Select value={projectId} onValueChange={handleProjectChange}>
                <SelectTrigger id="board-sync-project" className="w-full">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {availableProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) => {
                setProvider(v as ProviderKey);
                setContainers([]);
                setStates([]);
                setTeamId('');
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PROVIDERS) as ProviderKey[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {PROVIDERS[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {meta.configFields.map((field) => (
            <div key={field.key} className="flex flex-col gap-2">
              <Label htmlFor={`board-cfg-${field.key}`}>{field.label}</Label>
              <Input
                id={`board-cfg-${field.key}`}
                value={config[field.key] ?? ''}
                onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
              />
            </div>
          ))}

          <div className="flex flex-col gap-2">
            <Label htmlFor="board-sync-key">{meta.secretLabel}</Label>
            <div className="flex gap-2">
              <Input
                id="board-sync-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasStoredKey ? '•••••••• (stored — leave blank to keep)' : meta.secretPlaceholder}
                className="flex-1"
              />
              <Button variant="outline" onClick={fetchContainers} disabled={!canProbe || fetching}>
                <LinkIcon data-icon="inline-start" />
                Fetch
              </Button>
            </div>
          </div>

          {containers.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>{meta.containerLabel}</Label>
              <Select value={teamId} onValueChange={handleContainerChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={`Select a ${meta.containerLabel.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                  {containers.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.key ? ` (${t.key})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {states.length > 0 && swimlanes.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>Swimlane mappings</Label>
              <p className="text-xs text-muted-foreground">
                Map Orion board swimlanes to remote states.
              </p>
              <div className="flex flex-col gap-2">
                {swimlanes.map((col) => (
                  <div key={col} className="flex items-center gap-2">
                    <Badge variant="outline" className="w-32 shrink-0 justify-center">
                      {col}
                    </Badge>
                    <Select
                      value={stateMap[col] ?? ''}
                      onValueChange={(v) => setStateMap((prev) => ({ ...prev, [col]: v }))}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {states.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>Sync direction</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as BoardSyncDirection)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIRECTIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div>
              <Label>Push on move</Label>
              <p className="text-xs text-muted-foreground">
                Update the remote state immediately when a ticket moves.
              </p>
            </div>
            <Switch checked={autoPush} onCheckedChange={setAutoPush} disabled={direction === 'pull'} />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div>
              <Label>Import new issues</Label>
              <p className="text-xs text-muted-foreground">Create local tickets for new remote issues.</p>
            </div>
            <Switch checked={importNew} onCheckedChange={setImportNew} disabled={direction === 'push'} />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div>
              <Label>Update existing</Label>
              <p className="text-xs text-muted-foreground">Apply remote changes to synced tickets.</p>
            </div>
            <Switch
              checked={updateExisting}
              onCheckedChange={setUpdateExisting}
              disabled={direction === 'push'}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="board-sync-cadence">Sync every (minutes)</Label>
            <Input
              id="board-sync-cadence"
              type="number"
              min={1}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(e.target.value)}
              placeholder="Default (10)"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="board-sync-enabled">Enabled</Label>
            <Switch id="board-sync-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !teamId || !projectId}>
            {saving ? 'Saving...' : isEdit ? 'Save' : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
