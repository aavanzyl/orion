import { useState } from 'react';
import { Loader2Icon, SparklesIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { AgentTicketPreviewResponse } from '@orion/models';
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
import { Markdown } from '@/components/markdown';
import { api } from '@/lib/api';

interface CreateTicketAiModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  projects?: { id: string; name: string }[];
  onCreate: (preview: AgentTicketPreviewResponse, projectId: string) => Promise<void>;
  onOpenInForm?: (preview: AgentTicketPreviewResponse) => void;
}

export function CreateTicketAiModal({
  open,
  onOpenChange,
  projectId,
  projects,
  onCreate,
  onOpenInForm,
}: CreateTicketAiModalProps) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<AgentTicketPreviewResponse | null>(null);
  const [selectedProject, setSelectedProject] = useState(projectId ?? '');

  const effectiveProjectId = projects ? selectedProject : projectId;

  const reset = () => {
    setPrompt('');
    setPreview(null);
    if (projects) setSelectedProject(projectId ?? '');
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const generate = async () => {
    const pid = effectiveProjectId;
    if (!prompt.trim() || !pid) return;
    setLoading(true);
    setPreview(null);
    try {
      const result = await api.previewTicket(pid, prompt.trim());
      setPreview(result);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const generateDisabled = !prompt.trim() || loading || !effectiveProjectId;

  const handleCreate = async () => {
    if (!preview || !effectiveProjectId) return;
    try {
      await onCreate(preview, effectiveProjectId);
      toast.success('Ticket created');
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

  const priorityLabel = (p: number): string =>
    ['None', 'Urgent', 'High', 'Medium', 'Low'][p] ?? 'None';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-violet-700">
            <SparklesIcon className="size-5 text-violet-500" />
            Create ticket with AI
          </DialogTitle>
          <DialogDescription>
            Describe the ticket in natural language. The agent will draft it for you.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {projects && projects.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Project</Label>
              <Select value={selectedProject} onValueChange={setSelectedProject}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!preview && (
            <div className="rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void generate();
                  }
                }}
                placeholder="e.g. Add a dark mode toggle to settings that persists to localStorage and respects the system preference…"
                className="min-h-[100px] resize-none border-violet-200 bg-white text-sm focus-visible:ring-violet-500"
                disabled={loading}
                autoFocus
              />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] text-violet-600/70">
                  Press Enter to generate
                </span>
                <Button
                  onClick={generate}
                  disabled={generateDisabled}
                  className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700 shadow-[0_0_15px_rgba(139,92,246,0.3)] transition-shadow hover:shadow-[0_0_25px_rgba(139,92,246,0.5)]"
                >
                  {loading ? (
                    <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
                  ) : (
                    <SparklesIcon data-icon="inline-start" />
                  )}
                  Generate
                </Button>
              </div>
            </div>
          )}

          {preview && (
            <div className="rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50/50 to-fuchsia-50/50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Badge variant="secondary" className="bg-violet-100 text-violet-700 border-violet-200">
                  Draft
                </Badge>
                <span className="text-xs text-violet-600">{preview.reasoning}</span>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <Label className="text-[11px] text-muted-foreground">Title</Label>
                  <p className="text-sm font-medium">{preview.title}</p>
                </div>

                <div className="flex gap-4">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Type</Label>
                    <Badge variant="outline" className="mt-0.5 capitalize">{preview.type}</Badge>
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Priority</Label>
                    <Badge variant="outline" className="mt-0.5">{priorityLabel(preview.priority)}</Badge>
                  </div>
                  {preview.labels.length > 0 && (
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Labels</Label>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {preview.labels.map((label) => (
                          <Badge key={label} variant="secondary" className="text-xs">{label}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {preview.description && (
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Description</Label>
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-md border bg-white p-3 text-sm">
                      <Markdown content={preview.description} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleOpenChange.bind(null, false)}>
            Cancel
          </Button>
          {preview && (
            <>
              {onOpenInForm && (
                <Button variant="outline" onClick={handleEditInForm} className="border-violet-300 text-violet-700 hover:bg-violet-50">
                  Edit in form
                </Button>
              )}
              <Button
                onClick={handleCreate}
                className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700"
              >
                Create ticket
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
