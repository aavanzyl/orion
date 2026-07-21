import { useMemo, useState } from 'react';
import { ClockIcon, PencilIcon, PlayIcon, PlusIcon, SparklesIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { AgentSchedulePreviewResponse, Schedule } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { useProjects } from '@/features/projects/hooks';
import { useSchedules } from './hooks';
import { ScheduleFormDialog } from './schedule-form-dialog';
import { DeleteScheduleDialog } from './delete-schedule-dialog';
import { CreateScheduleAiModal } from './create-schedule-ai-modal';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const isSpecificDOW = dayOfWeek !== '*';
  const isSpecificDOM = dayOfMonth !== '*';
  const everyMinute = minute === '*' && hour === '*';
  const hourly = minute !== '*' && hour === '*';
  const daily = minute !== '*' && hour !== '*' && !isSpecificDOW && !isSpecificDOM;
  const weekly = minute !== '*' && hour !== '*' && isSpecificDOW;

  if (everyMinute) return 'Every minute';
  if (hourly) {
    const m = minute.split(',');
    if (m.length <= 2) return `Every hour at minute${m.length > 1 ? 's' : ''} ${minute}`;
    return `Every hour at minutes ${minute}`;
  }
  if (daily) {
    const h = parseInt(hour, 10);
    const m = minute.padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `Daily at ${h12}:${m} ${ampm}`;
  }
  if (weekly) {
    const h = parseInt(hour, 10);
    const m = minute.padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const days = dayOfWeek.split(',').map((d) => DAY_NAMES[parseInt(d, 10)] ?? d).join(', ');
    return `${days} at ${h12}:${m} ${ampm}`;
  }
  const monthDesc = month !== '*' ? ` in ${month.split(',').map((m) => MONTH_NAMES[parseInt(m, 10) - 1] ?? m).join(', ')}` : '';
  if (isSpecificDOM) {
    const h = parseInt(hour, 10);
    const m = minute.padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${dayOfMonth}${ordinal(parseInt(dayOfMonth, 10))} of the month at ${h12}:${m} ${ampm}${monthDesc}`;
  }
  return cron;
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export function SchedulesPage() {
  const { projects } = useProjects();
  const { schedules, loading, error, refetch } = useSchedules();
  const [formOpen, setFormOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null);
  const [deleteSchedule, setDeleteSchedule] = useState<Schedule | null>(null);
  const [firing, setFiring] = useState<string | null>(null);

  const [aiModalOpen, setAiModalOpen] = useState(false);

  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const toggle = async (schedule: Schedule, enabled: boolean) => {
    try {
      await api.updateSchedule(schedule.id, { enabled });
      refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const fire = async (schedule: Schedule) => {
    setFiring(schedule.id);
    try {
      await api.fireSchedule(schedule.id);
      toast.success(`Fired "${schedule.name}"`);
      refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFiring(null);
    }
  };

  const createScheduleFromAi = async (preview: AgentSchedulePreviewResponse, pid: string) => {
    await api.createSchedule(pid, {
      name: preview.name,
      cron: preview.cron,
      instruction: preview.instruction,
    });
    refetch();
  };

  const stats = useMemo(() => {
    const enabled = schedules.filter((s) => s.enabled).length;
    return { total: schedules.length, enabled };
  }, [schedules]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-3">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-lg font-semibold">Schedule</h1>
            <p className="text-xs text-muted-foreground">
              Run an agent on a cron schedule with a custom instruction.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {!loading && schedules.length > 0 && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                <span className="font-medium tabular-nums text-foreground">{stats.total}</span> schedule{stats.total !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-success" />
                <span className="font-medium tabular-nums text-foreground">{stats.enabled}</span> enabled
              </span>
            </div>
          )}
          <Button size="sm" onClick={() => { setEditSchedule(null); setFormOpen(true); }} disabled={projects.length === 0} className="max-lg:size-8 max-lg:px-0">
            <PlusIcon data-icon="inline-start" className="max-lg:mx-auto" />
            <span className="hidden lg:inline">New schedule</span>
          </Button>
          <Button
            size="sm"
            onClick={() => setAiModalOpen(true)}
            disabled={projects.length === 0}
            className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700 shadow-[0_0_15px_rgba(139,92,246,0.3)] transition-shadow hover:shadow-[0_0_25px_rgba(139,92,246,0.5)] animate-pulse-glow max-lg:size-8 max-lg:px-0"
          >
            <SparklesIcon data-icon="inline-start" className="max-lg:mx-auto" />
            <span className="hidden lg:inline">Create with AI</span>
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : loading ? (
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[0, 1, 2].map((i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-9" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : schedules.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <ClockIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No schedules yet. Create one to run an agent on a recurring schedule.
            </p>
          </div>
        ) : (
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-warning/10">
                          <ClockIcon className="size-3.5 text-warning" />
                        </div>
                        <div className="min-w-0">
                          <span className="block truncate text-sm font-medium">{schedule.name}</span>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {schedule.instruction}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {projectNames.get(schedule.projectId) ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="block w-fit cursor-help font-mono text-xs text-muted-foreground">
                              {schedule.cron}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{describeCron(schedule.cron)}</TooltipContent>
                        </Tooltip>
                        {schedule.nextFireAt && (
                          <p className="text-[11px] text-muted-foreground">
                            Next: {new Date(schedule.nextFireAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {schedule.skills.map((skill) => (
                          <Badge key={`skill-${skill}`} variant="secondary" className="text-[10px]">
                            {skill}
                          </Badge>
                        ))}
                        {schedule.mcpServers.map((server) => (
                          <Badge key={`mcp-${server}`} variant="outline" className="text-[10px]">
                            {server}
                          </Badge>
                        ))}
                        {schedule.skills.length === 0 && schedule.mcpServers.length === 0 && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={schedule.enabled}
                        onCheckedChange={(checked) => toggle(schedule, checked)}
                        aria-label="Enabled"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fire(schedule)}
                          disabled={firing === schedule.id}
                        >
                          <PlayIcon data-icon="inline-start" />
                          {firing === schedule.id ? 'Running…' : 'Run now'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            setEditSchedule(schedule);
                            setFormOpen(true);
                          }}
                          aria-label={`Edit ${schedule.name}`}
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteSchedule(schedule)}
                        >
                          <Trash2Icon data-icon="inline-start" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      <ScheduleFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditSchedule(null);
        }}
        projects={projects}
        defaultProjectId={null}
        onSaved={refetch}
        schedule={editSchedule}
      />

      <DeleteScheduleDialog
        schedule={deleteSchedule}
        onOpenChange={(open) => !open && setDeleteSchedule(null)}
        onDeleted={refetch}
      />

      <CreateScheduleAiModal
        open={aiModalOpen}
        onOpenChange={setAiModalOpen}
        projectId={projects[0]?.id ?? null}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        onCreate={createScheduleFromAi}
      />
    </div>
  );
}
