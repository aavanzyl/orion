import { useEffect, useMemo, useState } from 'react';
import {
  CopyIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  WebhookIcon,
  ZapIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Trigger } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { api, triggerWebhookUrl } from '@/lib/api';
import { cn, copyToClipboard } from '@/lib/utils';
import { useProjects } from '@/features/projects/hooks';
import { useTriggers } from './hooks';
import { TriggerFormDialog } from './trigger-form-dialog';

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

export function TriggersPage() {
  const { projects, loading: projectsLoading } = useProjects();
  const [projectId, setProjectId] = useState<string | null>(null);
  const { triggers, loading, error, refetch } = useTriggers(projectId);
  const [formOpen, setFormOpen] = useState(false);
  const [editTrigger, setEditTrigger] = useState<Trigger | null>(null);

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const toggle = async (trigger: Trigger, enabled: boolean) => {
    try {
      await api.updateTrigger(trigger.id, { enabled });
      refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const fire = async (trigger: Trigger) => {
    try {
      await api.fireTrigger(trigger.id);
      toast.success(`Fired "${trigger.name}" — run started`);
      refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (trigger: Trigger) => {
    try {
      await api.deleteTrigger(trigger.id);
      toast.success('Trigger removed');
      refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const copyWebhook = async (trigger: Trigger) => {
    if (!trigger.webhookToken) return;
    try {
      await copyToClipboard(triggerWebhookUrl(trigger.webhookToken));
      toast.success('Webhook URL copied');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const stats = useMemo(() => {
    const webhook = triggers.filter((t) => t.type === 'webhook').length;
    const cron = triggers.filter((t) => t.type === 'cron').length;
    return { total: triggers.length, webhook, cron };
  }, [triggers]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-3">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-lg font-semibold">Schedule</h1>
            <p className="text-xs text-muted-foreground">
              Auto-start workflow runs on a schedule or via an inbound webhook.
            </p>
          </div>
          <Select
            value={projectId ?? ''}
            onValueChange={setProjectId}
            disabled={projectsLoading || projects.length === 0}
          >
            <SelectTrigger className="h-8 w-48">
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-4">
          {!loading && triggers.length > 0 && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                <span className="font-medium tabular-nums text-foreground">{stats.total}</span> trigger{stats.total !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-warning" />
                <span className="font-medium tabular-nums text-foreground">{stats.cron}</span> cron
              </span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-info" />
                <span className="font-medium tabular-nums text-foreground">{stats.webhook}</span> webhook{stats.webhook !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          <Button size="sm" onClick={() => { setEditTrigger(null); setFormOpen(true); }} disabled={projects.length === 0}>
            <PlusIcon data-icon="inline-start" />
            New trigger
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
                  <TableHead>Type</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Schedule / URL</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[0, 1, 2].map((i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-14" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-9" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-8 w-20" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : triggers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <ZapIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No triggers yet. Create one to fire runs on a schedule or via a webhook.
            </p>
          </div>
        ) : (
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Schedule / URL</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {triggers.map((trigger) => (
                  <TableRow key={trigger.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            'flex size-7 shrink-0 items-center justify-center rounded-md',
                            trigger.type === 'webhook' ? 'bg-info/10' : 'bg-warning/10',
                          )}
                        >
                          {trigger.type === 'webhook' ? (
                            <WebhookIcon className="size-3.5 text-info" />
                          ) : (
                            <ZapIcon className="size-3.5 text-warning" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{trigger.name}</span>
                            <Badge
                              variant={trigger.type === 'webhook' ? 'info' : 'warning'}
                              className="shrink-0 text-[10px]"
                            >
                              {trigger.type}
                            </Badge>
                          </div>
                          {trigger.action === 'agent' && trigger.prompt && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              Prompt: {trigger.prompt}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={trigger.type === 'webhook' ? 'info' : 'warning'}>
                        {trigger.type === 'webhook' ? 'Webhook' : 'Cron'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{trigger.action}</Badge>
                    </TableCell>
                    <TableCell>
                      {trigger.type === 'cron' ? (
                        <div className="space-y-0.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block w-fit cursor-help font-mono text-xs text-muted-foreground">
                                {trigger.cron ?? ''}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{describeCron(trigger.cron ?? '')}</TooltipContent>
                          </Tooltip>
                          {trigger.nextFireAt && (
                            <p className="text-[11px] text-muted-foreground">
                              Next: {new Date(trigger.nextFireAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <code className="max-w-[240px] truncate rounded bg-muted px-1.5 py-0.5 text-[11px]">
                            {trigger.webhookToken ? triggerWebhookUrl(trigger.webhookToken) : '—'}
                          </code>
                          {trigger.webhookToken && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => copyWebhook(trigger)}
                              title="Copy webhook URL"
                            >
                              <CopyIcon className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={trigger.enabled}
                        onCheckedChange={(checked) => toggle(trigger, checked)}
                        aria-label="Enabled"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" onClick={() => fire(trigger)}>
                          <PlayIcon data-icon="inline-start" />
                          Fire now
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            setEditTrigger(trigger);
                            setFormOpen(true);
                          }}
                          aria-label={`Edit ${trigger.name}`}
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => remove(trigger)}
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

      <TriggerFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditTrigger(null);
        }}
        projects={projects}
        defaultProjectId={projectId}
        onSaved={refetch}
        trigger={editTrigger}
      />
    </div>
  );
}
