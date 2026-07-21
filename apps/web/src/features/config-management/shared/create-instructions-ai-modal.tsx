import { useState } from 'react';
import { Loader2Icon, SparklesIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { AgentInstructionsPreviewResponse } from '@orion/models';
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
import { Markdown } from '@/components/markdown';
import { api } from '@/lib/api';

interface CreateInstructionsAiModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user accepts the generated instructions. */
  onApply: (instructions: string) => void;
  /** Optional node label shown as context above the prompt. */
  nodeId?: string;
}

const dialogBg = 'bg-[#0d1014] dark:bg-[#e8e8e8] text-gray-100 dark:text-gray-900 border-gray-800 dark:border-gray-300';
const inputBg = 'bg-[#0d1014] dark:bg-white border-gray-700 dark:border-gray-300 text-gray-100 dark:text-gray-900 placeholder:text-gray-500 dark:placeholder:text-gray-400';
const labelMuted = 'text-gray-400 dark:text-gray-500';
const panelBorder = 'border-violet-800 dark:border-violet-200';
const panelBg = 'bg-violet-950/40 dark:bg-gradient-to-br dark:from-violet-50 dark:to-fuchsia-50';
const draftBadge = 'bg-violet-900/50 dark:bg-violet-100 text-violet-300 dark:text-violet-700 border-violet-800 dark:border-violet-200';
const outlineBtn = 'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] dark:focus-visible:ring-offset-[#e8e8e8] h-9 px-4 py-2 border border-gray-600 dark:border-gray-300 text-gray-200 dark:text-gray-600 hover:bg-gray-700 hover:text-white dark:hover:bg-gray-300 dark:hover:text-gray-800 disabled:opacity-50';
const titleColor = 'text-violet-400 dark:text-violet-700';
const iconColor = 'text-violet-500';
const descColor = 'text-gray-400 dark:text-gray-600';
const cardBg = 'bg-[#0d1014] dark:bg-white border-gray-700 dark:border-gray-300';

export function CreateInstructionsAiModal({
  open,
  onOpenChange,
  onApply,
  nodeId,
}: CreateInstructionsAiModalProps) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<AgentInstructionsPreviewResponse | null>(null);
  const [validated, setValidated] = useState(false);

  const reset = () => {
    setPrompt('');
    setPreview(null);
    setValidated(false);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const needsPrompt = !prompt.trim();

  const generate = async () => {
    if (needsPrompt) { setValidated(true); return; }
    setValidated(false);
    setLoading(true);
    setPreview(null);
    try {
      const result = await api.previewInstructions(prompt.trim());
      setPreview(result);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!preview) return;
    onApply(preview.content);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={`sm:max-w-2xl ${dialogBg}`}>
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${titleColor}`}>
            <SparklesIcon className={`size-5 ${iconColor}`} />
            Write instructions with AI
          </DialogTitle>
          <DialogDescription className={descColor}>
            Describe what you want this agent to do. The agent will draft instructions
            using available template variables.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {!preview && (
            <div className={`rounded-lg border ${panelBorder} ${panelBg}`}>
              {nodeId && (
                <div className="px-4 pt-4 pb-0">
                  <Label className={labelMuted}>Node</Label>
                  <p className="font-mono text-sm">{nodeId}</p>
                </div>
              )}
              <Textarea
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); if (e.target.value.trim()) setValidated(false); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void generate(); }
                }}
                placeholder="e.g. This agent reviews pull requests for security vulnerabilities before merging, checking for exposed secrets, unsafe dependencies, and injection risks…"
                className={`min-h-[80px] resize-none rounded-lg ${inputBg} border-0 focus-visible:ring-0 ${validated && needsPrompt ? 'ring-2 ring-red-500' : ''}`}
                disabled={loading}
                autoFocus
              />
              {validated && needsPrompt && (
                <p className="mt-1 px-1 text-xs text-red-400">Describe what the agent should do</p>
              )}
            </div>
          )}

          {preview && (
            <div className={`rounded-lg border ${panelBorder} ${panelBg} p-4`}>
              <div className="mb-3 flex items-center gap-2">
                <Badge variant="secondary" className={draftBadge}>Draft</Badge>
                <span className={`text-xs ${descColor}`}>{preview.reasoning}</span>
              </div>
              <div>
                <Label className={`text-[11px] ${labelMuted}`}>Instructions</Label>
                <div className={`mt-1 max-h-[40vh] overflow-y-auto rounded-md border ${cardBg} p-3 text-sm`}>
                  <Markdown content={preview.content} />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto text-[11px] text-gray-500">Press Enter to generate</span>
          <button type="button" onClick={handleOpenChange.bind(null, false)} className={outlineBtn}>Cancel</button>
          {preview ? (
            <Button onClick={handleApply} className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700">
              Apply instructions
            </Button>
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
