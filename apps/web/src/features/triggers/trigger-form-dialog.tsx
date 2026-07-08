import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Project, Trigger, TriggerAction, TriggerType } from '@orion/models';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';

export interface TriggerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  /** Pre-selected project when the dialog opens. */
  defaultProjectId: string | null;
  onSaved: () => void;
  /** When set, the dialog operates in edit mode for an existing trigger. */
  trigger?: Trigger | null;
}

export function TriggerFormDialog({
  open,
  onOpenChange,
  projects,
  defaultProjectId,
  onSaved,
  trigger,
}: TriggerFormDialogProps) {
  const editMode = !!trigger;
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<TriggerType>('cron');
  const [action, setAction] = useState<TriggerAction>('workflow');
  const [cron, setCron] = useState('0 9 * * *');
  const [ticketTitle, setTicketTitle] = useState('');
  const [swimlane, setSwimlane] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agentId, setAgentId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (trigger) {
      setProjectId(trigger.projectId);
      setName(trigger.name);
      setType(trigger.type);
      setAction(trigger.action);
      setCron(trigger.cron ?? '0 9 * * *');
      setTicketTitle(trigger.ticketTitle ?? '');
      setSwimlane(trigger.swimlane ?? '');
      setPrompt(trigger.prompt ?? '');
      setAgentId(trigger.agentId ?? '');
    } else {
      setProjectId(defaultProjectId ?? projects[0]?.id ?? '');
      setName('');
      setType('cron');
      setAction('workflow');
      setCron('0 9 * * *');
      setTicketTitle('');
      setSwimlane('');
      setPrompt('');
      setAgentId('');
    }
  }, [open, defaultProjectId, projects, trigger]);

  const valid =
    projectId.length > 0 &&
    name.trim().length > 0 &&
    (type !== 'cron' || cron.trim().length > 0) &&
    (action !== 'agent' || prompt.trim().length > 0);

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      if (trigger) {
        await api.updateTrigger(trigger.id, {
          name: name.trim(),
          action,
          cron: type === 'cron' ? cron.trim() : undefined,
          ticketTitle: action === 'workflow' ? ticketTitle.trim() || undefined : undefined,
          swimlane: action === 'workflow' ? swimlane.trim() || undefined : undefined,
          prompt: action === 'agent' ? prompt.trim() : undefined,
          agentId: action === 'agent' ? agentId.trim() || undefined : undefined,
        });
        toast.success('Trigger updated');
      } else {
        await api.createTrigger(projectId, {
          name: name.trim(),
          type,
          action,
          cron: type === 'cron' ? cron.trim() : undefined,
          ticketTitle: action === 'workflow' ? ticketTitle.trim() || undefined : undefined,
          swimlane: action === 'workflow' ? swimlane.trim() || undefined : undefined,
          prompt: action === 'agent' ? prompt.trim() : undefined,
          agentId: action === 'agent' ? agentId.trim() || undefined : undefined,
        });
        toast.success('Trigger created');
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
          <DialogTitle>{editMode ? 'Edit trigger' : 'Create trigger'}</DialogTitle>
          <DialogDescription>
            A trigger fires on a cron schedule or an inbound webhook. It can start a run of the
            project&apos;s workflow (creating a ticket) or run a one-off agent turn with a prompt.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="trigger-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={editMode}>
              <SelectTrigger id="trigger-project" className="w-full">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="trigger-name">Name</Label>
              <Input
                id="trigger-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nightly refactor"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="trigger-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as TriggerType)} disabled={editMode}>
                <SelectTrigger id="trigger-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cron">Cron schedule</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="trigger-action">Action</Label>
            <Select value={action} onValueChange={(v) => setAction(v as TriggerAction)}>
              <SelectTrigger id="trigger-action" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workflow">Start workflow (create ticket)</SelectItem>
                <SelectItem value="agent">Run an agent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === 'cron' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="trigger-cron">Cron expression</Label>
              <Input
                id="trigger-cron"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 9 * * *"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Standard 5-field cron. e.g. <code>0 9 * * *</code> runs every day at 09:00.
              </p>
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              A secret webhook URL is generated on creation. Copy it from the trigger list and POST
              a JSON body (<code>title</code>/<code>description</code>) to fire it.
            </p>
          )}

          {action === 'agent' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="trigger-prompt">Prompt</Label>
                <Textarea
                  id="trigger-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Instruction for the agent to run, e.g. Review open PRs and file a ticket for anything stale."
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="trigger-agent">Agent id</Label>
                <Input
                  id="trigger-agent"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  placeholder="Optional — the project's default agent"
                  className="font-mono"
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="trigger-ticket-title">Ticket title</Label>
                <Input
                  id="trigger-ticket-title"
                  value={ticketTitle}
                  onChange={(e) => setTicketTitle(e.target.value)}
                  placeholder="Optional — defaults to the trigger name"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="trigger-swimlane">Swimlane</Label>
                <Input
                  id="trigger-swimlane"
                  value={swimlane}
                  onChange={(e) => setSwimlane(e.target.value)}
                  placeholder="Optional — first board swimlane"
                  className="font-mono"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !valid}>
            {editMode ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
