import { useCallback, useEffect, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, type LinearState, type LinearTeam } from '@/lib/api';

export interface BoardSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Projects selectable when adding a new sync (already-connected ones excluded). */
  availableProjects: Project[];
  /** When set, the dialog edits this project's existing connection. */
  editProject: Project | null;
  onSaved: () => void;
}

export function BoardSyncDialog({
  open,
  onOpenChange,
  availableProjects,
  editProject,
  onSaved,
}: BoardSyncDialogProps) {
  const isEdit = editProject != null;
  const [projectId, setProjectId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [teamId, setTeamId] = useState('');
  const [states, setStates] = useState<LinearState[]>([]);
  const [stateMap, setStateMap] = useState<Record<string, string>>({});
  const [swimlanes, setSwimlanes] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSwimlanes = useCallback(async (id: string, preserve: boolean) => {
    try {
      const config = await api.getProjectConfig(id);
      setSwimlanes(config.board.swimlanes);
      if (!preserve) {
        setStateMap(Object.fromEntries(config.board.swimlanes.map((c) => [c, ''])));
      }
    } catch {
      setSwimlanes([]);
    }
  }, []);

  const fetchStates = useCallback(async (id: string, key: string, tId: string) => {
    if (!id || !key || !tId) return;
    try {
      const result = await api.listLinearStates(id, key, tId);
      setStates(result);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTeams([]);
    setStates([]);
    if (editProject) {
      setProjectId(editProject.id);
      setFetching(true);
      Promise.all([
        api.getBoardConnection(editProject.id),
        api.getProjectConfig(editProject.id),
      ])
        .then(async ([conn, config]) => {
          setSwimlanes(config.board.swimlanes);
          setTeamId(conn.teamId ?? '');
          setStateMap(conn.stateMap ?? {});
          setEnabled(conn.enabled ?? true);
          const key = conn.apiKey ?? '';
          setApiKey(key);
          if (key) {
            const fetchedTeams = await api
              .listLinearTeams(editProject.id, key)
              .catch(() => [] as LinearTeam[]);
            setTeams(fetchedTeams);
            if (conn.teamId) await fetchStates(editProject.id, key, conn.teamId);
          }
        })
        .catch((e) => toast.error((e as Error).message))
        .finally(() => setFetching(false));
    } else {
      const first = availableProjects[0]?.id ?? '';
      setProjectId(first);
      setApiKey('');
      setTeamId('');
      setStateMap({});
      setEnabled(true);
      setSwimlanes([]);
      if (first) loadSwimlanes(first, false);
    }
  }, [open, editProject, availableProjects, loadSwimlanes, fetchStates]);

  const handleProjectChange = (id: string) => {
    setProjectId(id);
    setTeams([]);
    setStates([]);
    setTeamId('');
    loadSwimlanes(id, false);
  };

  const fetchTeams = async () => {
    if (!apiKey || !projectId) return;
    setFetching(true);
    try {
      const result = await api.listLinearTeams(projectId, apiKey);
      setTeams(result);
      toast.success(`Found ${result.length} team(s)`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFetching(false);
    }
  };

  const handleTeamChange = (v: string) => {
    setTeamId(v);
    fetchStates(projectId, apiKey, v);
  };

  const save = async () => {
    if (!projectId || !teamId) return;
    setSaving(true);
    try {
      const filteredMap: Record<string, string> = {};
      for (const [col, stateId] of Object.entries(stateMap)) {
        if (stateId) filteredMap[col] = stateId;
      }
      await api.saveBoardConnection(projectId, {
        apiKey: apiKey || undefined,
        teamId,
        stateMap: filteredMap,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit board sync' : 'Add board sync'}</DialogTitle>
          <DialogDescription>
            Connect a Linear team to a project. Board swimlane changes push to Linear, and
            Linear updates pull back on a periodic heartbeat.
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
            <Label htmlFor="board-sync-key">Linear API key</Label>
            <div className="flex gap-2">
              <Input
                id="board-sync-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="lin_api_..."
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={fetchTeams}
                disabled={!apiKey || !projectId || fetching}
              >
                <LinkIcon data-icon="inline-start" />
                Fetch teams
              </Button>
            </div>
          </div>

          {teams.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>Team</Label>
              <Select value={teamId} onValueChange={handleTeamChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.key})
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
                Map Orion board swimlanes to Linear workflow states.
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
