import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIcon, PencilIcon, PlusIcon, RefreshCwIcon, UnlinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@orion/models';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProjects } from '@/features/projects/hooks';
import { api, type BoardConnectionResponse } from '@/lib/api';
import { BoardSyncDialog } from './board-sync-dialog';

interface SyncRow {
  project: Project;
  connection: BoardConnectionResponse;
}

export function BoardSyncSection() {
  const { projects, loading: projectsLoading } = useProjects();
  const [rows, setRows] = useState<SyncRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);

  const load = useCallback(async () => {
    if (projects.length === 0) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const results = await Promise.all(
        projects.map(async (project) => {
          try {
            const connection = await api.getBoardConnection(project.id);
            return connection.connected ? { project, connection } : null;
          } catch {
            return null;
          }
        }),
      );
      setRows(results.filter((r): r is SyncRow => r !== null));
    } finally {
      setLoading(false);
    }
  }, [projects]);

  useEffect(() => {
    load();
  }, [load]);

  const availableProjects = useMemo(() => {
    const connected = new Set(rows.map((r) => r.project.id));
    return projects.filter((p) => !connected.has(p.id));
  }, [projects, rows]);

  const openAdd = () => {
    setEditProject(null);
    setDialogOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditProject(project);
    setDialogOpen(true);
  };

  const syncNow = async (project: Project) => {
    setSyncingId(project.id);
    try {
      const result = await api.syncBoardConnection(project.id);
      toast.success(`Synced: ${result.imported} imported, ${result.updated} updated`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncingId(null);
    }
  };

  const toggleEnabled = async (row: SyncRow, enabled: boolean) => {
    try {
      await api.saveBoardConnection(row.project.id, { enabled });
      setRows((prev) =>
        prev.map((r) =>
          r.project.id === row.project.id
            ? { ...r, connection: { ...r.connection, enabled } }
            : r,
        ),
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const [disconnectingProject, setDisconnectingProject] = useState<Project | null>(null);

  const disconnect = async (project: Project) => {
    setDisconnectingProject(project);
  };

  const confirmDisconnect = async () => {
    if (!disconnectingProject) return;
    try {
      await api.deleteBoardConnection(disconnectingProject.id);
      toast.success('Disconnected');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const busy = projectsLoading || loading;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ActivityIcon className="size-4" />
              Board sync
            </CardTitle>
            <CardDescription>
              Continuously sync Linear, Jira, or Trello boards with Orion. Swimlane changes push
              upstream and remote updates pull back on a configurable cadence.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openAdd} disabled={availableProjects.length === 0}>
            <PlusIcon data-icon="inline-start" />
            Add sync
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {busy ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No board syncs yet. Click <strong>Add sync</strong> to connect a project to a
              Linear, Jira, or Trello board.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Board</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last synced</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.project.id}>
                  <TableCell className="font-medium">{row.project.name}</TableCell>
                  <TableCell className="capitalize">
                    {row.connection.provider ?? 'linear'}
                  </TableCell>
                  <TableCell>
                    {row.connection.teamId ? (
                      <Badge variant="secondary" className="font-mono">
                        {row.connection.teamId}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={row.connection.enabled ?? true}
                        onCheckedChange={(checked) => toggleEnabled(row, checked)}
                        aria-label="Enabled"
                      />
                      <span className="text-xs text-muted-foreground">
                        {row.connection.enabled ?? true ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.connection.lastSyncedAt
                      ? new Date(row.connection.lastSyncedAt).toLocaleString()
                      : 'Never'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Sync now"
                        disabled={syncingId === row.project.id}
                        onClick={() => syncNow(row.project)}
                      >
                        <RefreshCwIcon
                          className={syncingId === row.project.id ? 'animate-spin' : ''}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Edit mappings"
                        onClick={() => openEdit(row.project)}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Disconnect"
                        className="text-destructive hover:text-destructive"
                        onClick={() => disconnect(row.project)}
                      >
                        <UnlinkIcon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <BoardSyncDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        availableProjects={availableProjects}
        editProject={editProject}
        onSaved={load}
      />

      <ConfirmDialog
        open={disconnectingProject !== null}
        onOpenChange={(open) => { if (!open) setDisconnectingProject(null); }}
        title="Disconnect board sync"
        description={`Disconnect board sync for "${disconnectingProject?.name}"?`}
        confirmLabel="Disconnect"
        onConfirm={confirmDisconnect}
      />
    </Card>
  );
}
