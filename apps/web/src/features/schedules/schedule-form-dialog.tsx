import { useEffect, useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { McpServerConfig, Project, Schedule } from '@orion/models';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { BUILTIN_SERVERS } from '@/features/settings/mcp-shared';

export interface ScheduleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  /** Pre-selected project when the dialog opens. */
  defaultProjectId: string | null;
  onSaved: () => void;
  /** When set, the dialog operates in edit mode for an existing schedule. */
  schedule?: Schedule | null;
}

type PickerView = 'skills' | 'mcp' | null;

export function ScheduleFormDialog({
  open,
  onOpenChange,
  projects,
  defaultProjectId,
  onSaved,
  schedule,
}: ScheduleFormDialogProps) {
  const editMode = !!schedule;
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [instruction, setInstruction] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);
  const [availableMcp, setAvailableMcp] = useState<string[]>([]);
  /** Names present in the project config (resolved server-side at fire time). */
  const [projectMcp, setProjectMcp] = useState<string[]>([]);
  /** DB global MCP server configs keyed by name, for inline capture on save. */
  const [globalMcp, setGlobalMcp] = useState<Record<string, McpServerConfig>>({});
  const [submitting, setSubmitting] = useState(false);
  const [picker, setPicker] = useState<PickerView>(null);

  useEffect(() => {
    if (!open) return;
    setPicker(null);
    if (schedule) {
      setProjectId(schedule.projectId);
      setName(schedule.name);
      setCron(schedule.cron);
      setInstruction(schedule.instruction);
      setSkills(schedule.skills);
      setMcpServers(schedule.mcpServers);
    } else {
      setProjectId(defaultProjectId ?? projects[0]?.id ?? '');
      setName('');
      setCron('0 9 * * *');
      setInstruction('');
      setSkills([]);
      setMcpServers([]);
    }
  }, [open, defaultProjectId, projects, schedule]);

  useEffect(() => {
    if (!open || !projectId) {
      setAvailableSkills([]);
      setAvailableMcp([]);
      setProjectMcp([]);
      setGlobalMcp({});
      return;
    }
    let cancelled = false;
    Promise.all([
      api.listScheduleOptions(projectId),
      api.listMcpServers(),
    ])
      .then(([options, dbServers]) => {
        if (cancelled) return;
        setAvailableSkills(options.skills);
        setProjectMcp(options.mcpServers);
        const dbMcpConfigs: Record<string, McpServerConfig> = {};
        for (const s of dbServers) {
          dbMcpConfigs[s.name] = s.config;
        }
        setGlobalMcp(dbMcpConfigs);
        const merged = Array.from(
          new Set([
            ...options.mcpServers,
            ...options.globalMcpServers,
            ...dbServers.map((s) => s.name),
            ...BUILTIN_SERVERS.map((s) => s.key),
          ]),
        );
        setAvailableMcp(merged);
      })
      .catch(() => {
        if (cancelled) return;
        setAvailableSkills([]);
        setProjectMcp([]);
        setGlobalMcp({});
        setAvailableMcp([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const valid =
    projectId.length > 0 &&
    name.trim().length > 0 &&
    cron.trim().length > 0 &&
    instruction.trim().length > 0;

  const addSkill = (skill: string) => {
    setSkills((prev) => (prev.includes(skill) ? prev : [...prev, skill]));
    setPicker(null);
  };

  const addMcp = (server: string) => {
    setMcpServers((prev) => (prev.includes(server) ? prev : [...prev, server]));
    setPicker(null);
  };

  const removeSkill = (skill: string) =>
    setSkills((prev) => prev.filter((s) => s !== skill));
  const removeMcp = (server: string) =>
    setMcpServers((prev) => prev.filter((s) => s !== server));

  const remainingSkills = availableSkills.filter((s) => !skills.includes(s));
  const remainingMcp = availableMcp.filter((s) => !mcpServers.includes(s));

  const handleDialogOpenChange = (next: boolean) => {
    if (next) return;
    if (picker !== null) {
      setPicker(null);
      return;
    }
    onOpenChange(false);
  };

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    // Capture inline configs for any selected server not in the project
    // config (e.g. DB global servers) as a fallback for schedule resolution.
    const mcpServerConfigs = mcpServers.reduce<Record<string, McpServerConfig>>(
      (acc, name) => {
        if (!projectMcp.includes(name) && globalMcp[name]) acc[name] = globalMcp[name];
        return acc;
      },
      {},
    );
    try {
      if (schedule) {
        await api.updateSchedule(schedule.id, {
          name: name.trim(),
          cron: cron.trim(),
          instruction: instruction.trim(),
          skills,
          mcpServers,
          mcpServerConfigs,
        });
        toast.success('Schedule updated');
      } else {
        await api.createSchedule(projectId, {
          name: name.trim(),
          cron: cron.trim(),
          instruction: instruction.trim(),
          skills,
          mcpServers,
          mcpServerConfigs,
        });
        toast.success('Schedule created');
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
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      {picker === null && (
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editMode ? 'Edit schedule' : 'Create schedule'}
            </DialogTitle>
            <DialogDescription>
              A schedule runs an agent on a cron schedule with a custom
              instruction. The agent can always read and write the board and
              search the codebase, plus use any skills and MCP servers you
              select below.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="schedule-project">Project</Label>
              <Select
                value={projectId}
                onValueChange={setProjectId}
                disabled={editMode}
              >
                <SelectTrigger id="schedule-project" className="w-full">
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
                <Label htmlFor="schedule-name">Name</Label>
                <Input
                  id="schedule-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nightly board triage"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="schedule-cron">Cron expression</Label>
                <Input
                  id="schedule-cron"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 9 * * *"
                  className="font-mono"
                />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              Standard 5-field cron. e.g. <code>0 9 * * *</code> runs every day
              at 09:00.
            </p>

            <div className="flex flex-col gap-2">
              <Label htmlFor="schedule-instruction">Instruction</Label>
              <Textarea
                id="schedule-instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={10}
                className="min-h-48"
                placeholder="What should the agent do on each run? e.g. Review open tickets, close anything stale, and file a ticket for any failing checks."
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-medium">Skills</span>
                  <p className="text-xs text-muted-foreground">
                    Instruction bundles that guide how the agent works.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPicker('skills')}
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
                        <TableHead className="w-0" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {skills.map((skill) => (
                        <TableRow key={skill}>
                          <TableCell>
                            <span className="font-mono text-sm font-medium">
                              {skill}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => removeSkill(skill)}
                              aria-label={`Remove ${skill}`}
                            >
                              <Trash2Icon />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  No skills added.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-medium">MCP servers</span>
                  <p className="text-xs text-muted-foreground">
                    The board and codebase MCP servers are always available.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPicker('mcp')}
                >
                  <PlusIcon data-icon="inline-start" />
                  Add server
                </Button>
              </div>
              {mcpServers.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="w-0" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mcpServers.map((server) => (
                        <TableRow key={server}>
                          <TableCell>
                            <span className="font-mono text-sm font-medium">
                              {server}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => removeMcp(server)}
                              aria-label={`Remove ${server}`}
                            >
                              <Trash2Icon />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  No MCP servers added.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting || !valid}>
              {editMode ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}

      {picker === 'skills' && (
        <DialogContent className="flex max-h-[70vh] max-w-md flex-col">
          <DialogHeader>
            <DialogTitle>Add skill</DialogTitle>
            <DialogDescription>
              Select a skill to enable for this schedule.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
            {remainingSkills.map((skill) => (
              <button
                key={skill}
                type="button"
                onClick={() => addSkill(skill)}
                className="cursor-pointer rounded-md border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50"
              >
                <span className="text-sm font-medium">{skill}</span>
              </button>
            ))}
            {remainingSkills.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {availableSkills.length === 0
                  ? 'No skills registered for this project. Install skills on the Skills page.'
                  : 'All available skills have been added.'}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicker(null)}>
              Back
            </Button>
          </DialogFooter>
        </DialogContent>
      )}

      {picker === 'mcp' && (
        <DialogContent className="flex max-h-[70vh] max-w-md flex-col">
          <DialogHeader>
            <DialogTitle>Add MCP server</DialogTitle>
            <DialogDescription>
              Select an MCP server to expose to this schedule.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
            {remainingMcp.map((server) => (
              <button
                key={server}
                type="button"
                onClick={() => addMcp(server)}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-md border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50"
              >
                <span className="text-sm font-medium">{server}</span>
                {!projectMcp.includes(server) && globalMcp[server] && (
                  <span className="text-xs text-muted-foreground">Global</span>
                )}
              </button>
            ))}
            {remainingMcp.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {availableMcp.length === 0
                  ? 'No additional MCP servers registered for this project. Add them on the MCP page.'
                  : 'All available MCP servers have been added.'}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicker(null)}>
              Back
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
