import { useState } from 'react';
import { Loader2Icon, SparklesIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { AgentSchedulePreviewResponse } from '@orion/models';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';

interface CreateScheduleAiModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  projects?: { id: string; name: string }[];
  onCreate: (preview: AgentSchedulePreviewResponse, projectId: string) => Promise<void>;
  onOpenInForm?: (preview: AgentSchedulePreviewResponse) => void;
}

const dialogBg = 'bg-[#0d1014] dark:bg-[#e8e8e8] text-gray-100 dark:text-gray-900 border-gray-800 dark:border-gray-300';
const inputBg = 'bg-[#0d1014] dark:bg-white border-gray-700 dark:border-gray-300 text-gray-100 dark:text-gray-900 placeholder:text-gray-500 dark:placeholder:text-gray-400';
const labelMuted = 'text-gray-400 dark:text-gray-500';
const panelBorder = 'border-violet-800 dark:border-violet-200';
const panelBg = 'bg-violet-950/40 dark:bg-gradient-to-br dark:from-violet-50 dark:to-fuchsia-50';
const draftBadge = 'bg-violet-900/50 dark:bg-violet-100 text-violet-300 dark:text-violet-700 border-violet-800 dark:border-violet-200';
const outlineBtn = 'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] dark:focus-visible:ring-offset-[#e8e8e8] h-9 px-4 py-2 border border-gray-600 dark:border-gray-300 text-gray-200 dark:text-gray-600 hover:bg-gray-700 hover:text-white dark:hover:bg-gray-300 dark:hover:text-gray-800 disabled:opacity-50';
const violetOutlineBtn = 'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] dark:focus-visible:ring-offset-[#e8e8e8] h-9 px-4 py-2 border border-violet-700 dark:border-violet-300 text-violet-400 dark:text-violet-700 hover:bg-violet-900/40 hover:text-violet-300 dark:hover:bg-violet-100 dark:hover:text-violet-800 disabled:opacity-50';
const titleColor = 'text-violet-400 dark:text-violet-700';
const iconColor = 'text-violet-500';
const descColor = 'text-gray-400 dark:text-gray-600';
const cardBg = 'bg-[#0d1014] dark:bg-white border-gray-700 dark:border-gray-300';

export function CreateScheduleAiModal({
  open,
  onOpenChange,
  projectId,
  projects,
  onCreate,
  onOpenInForm,
}: CreateScheduleAiModalProps) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<AgentSchedulePreviewResponse | null>(null);
  const [validated, setValidated] = useState(false);
  const [selectedProject, setSelectedProject] = useState(projectId ?? '');

  const effectiveProjectId = projects ? selectedProject : projectId;

  const reset = () => {
    setPrompt('');
    setPreview(null);
    setValidated(false);
    if (projects) setSelectedProject(projectId ?? '');
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const needsPrompt = !prompt.trim();
  const needsProject = projects && !selectedProject;

  const generate = async () => {
    if (needsPrompt || needsProject) { setValidated(true); return; }
    setValidated(false);
    setLoading(true);
    setPreview(null);
    try {
      const result = await api.previewSchedule(effectiveProjectId!, prompt.trim());
      setPreview(result);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!preview || !effectiveProjectId) return;
    try {
      await onCreate(preview, effectiveProjectId);
      toast.success('Schedule created');
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleEditInForm = () => {
    if (!preview) return;
    onOpenInForm?.(preview);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={`sm:max-w-xl ${dialogBg}`}>
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${titleColor}`}>
            <SparklesIcon className={`size-5 ${iconColor}`} />
            Create schedule with AI
          </DialogTitle>
          <DialogDescription className={descColor}>
            Describe what you want the agent to do on a schedule. The agent will figure out the cron and instruction.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {projects && projects.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className={`text-xs ${labelMuted}`}>Project</Label>
              <Select value={selectedProject} onValueChange={(v) => { setSelectedProject(v); if (v) setValidated(false); }}>
                <SelectTrigger className={inputBg}>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {validated && needsProject && (
                <p className="text-xs text-red-400">Select a project first</p>
              )}
            </div>
          )}
          {!preview && (
            <div className={`rounded-lg border ${panelBorder} ${panelBg}`}>
              <Textarea
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); if (e.target.value.trim()) setValidated(false); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void generate(); }
                }}
                placeholder="e.g. Every weekday morning at 9am, review open pull requests and post a summary of any security concerns to the team channel…"
                className={`min-h-[100px] resize-none rounded-lg ${inputBg} border-0 focus-visible:ring-0 ${validated && needsPrompt ? 'ring-2 ring-red-500' : ''}`}
                disabled={loading}
                autoFocus
              />
              {validated && needsPrompt && (
                <p className="mt-1 px-1 text-xs text-red-400">Describe what the schedule should do</p>
              )}
            </div>
          )}

          {preview && (
            <div className={`rounded-lg border ${panelBorder} ${panelBg} p-4`}>
              <div className="mb-3 flex items-center gap-2">
                <Badge variant="secondary" className={draftBadge}>Draft</Badge>
                <span className={`text-xs ${descColor}`}>{preview.reasoning}</span>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <Label className={`text-[11px] ${labelMuted}`}>Name</Label>
                  <p className="text-sm font-medium">{preview.name}</p>
                </div>
                <div>
                  <Label className={`text-[11px] ${labelMuted}`}>Cron</Label>
                  <p className="font-mono text-sm">{preview.cron}</p>
                </div>
                <div>
                  <Label className={`text-[11px] ${labelMuted}`}>Instruction</Label>
                  <p className={`mt-1 max-h-32 overflow-y-auto rounded-md border ${cardBg} p-2 text-sm whitespace-pre-wrap`}>
                    {preview.instruction}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto text-[11px] text-gray-500">Press Enter to generate</span>
          <button type="button" onClick={handleOpenChange.bind(null, false)} className={outlineBtn}>Cancel</button>
          {preview ? (
            <>
              {onOpenInForm && (
                <button type="button" onClick={handleEditInForm} className={violetOutlineBtn}>Edit in form</button>
              )}
              <Button onClick={handleCreate} className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700">
                Create schedule
              </Button>
            </>
          ) : (
            <Button
              onClick={generate}
              disabled={loading}
              className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700 shadow-[0_0_15px_rgba(139,92,246,0.3)] transition-shadow hover:shadow-[0_0_25px_rgba(139,92,246,0.5)]"
            >
              {loading ? <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
              Generate
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
