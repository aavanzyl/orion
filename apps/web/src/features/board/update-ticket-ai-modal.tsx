import { useState } from 'react';
import { Loader2Icon, SparklesIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { AgentTicketUpdateResponse, UpdateTicketInput } from '@orion/models';
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
import { api } from '@/lib/api';

interface UpdateTicketAiModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  ticketTitle: string;
  ticketDescription: string;
  ticketType: string;
  ticketPriority: number;
  onApplied: () => void;
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
const badgeOutline = 'border-gray-600 dark:border-gray-300 text-gray-300 dark:text-gray-700';
const mutedCard = 'border-gray-700 dark:border-gray-300 bg-gray-900/50 dark:bg-gray-100';

export function UpdateTicketAiModal({
  open,
  onOpenChange,
  ticketId,
  ticketTitle,
  ticketDescription,
  ticketType,
  ticketPriority,
  onApplied,
}: UpdateTicketAiModalProps) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AgentTicketUpdateResponse | null>(null);
  const [applying, setApplying] = useState(false);
  const [validated, setValidated] = useState(false);

  const reset = () => {
    setPrompt('');
    setResult(null);
    setValidated(false);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const needsPrompt = !prompt.trim();

  const generate = async () => {
    if (needsPrompt) {
      setValidated(true);
      return;
    }
    setValidated(false);
    setLoading(true);
    setResult(null);
    try {
      const r = await api.previewTicketUpdate(ticketId, prompt.trim());
      setResult(r);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    setApplying(true);
    try {
      const input: UpdateTicketInput = {};
      if (result.title) input.title = result.title;
      if (result.description) input.description = result.description;
      if (result.type) input.type = result.type;
      if (result.priority !== undefined) input.priority = result.priority as import('@orion/models').TicketPriority;
      if (result.labelIds) input.labelIds = result.labelIds;
      if (Object.keys(input).length > 0) {
        await api.updateTicket(ticketId, input);
      }
      toast.success('Ticket updated');
      onApplied();
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const priorityLabel = (p: number): string =>
    ['None', 'Urgent', 'High', 'Medium', 'Low'][p] ?? 'None';

  const changedFields: string[] = [];
  if (result) {
    if (result.title) changedFields.push('Title');
    if (result.description) changedFields.push('Description');
    if (result.type) changedFields.push('Type');
    if (result.priority !== undefined) changedFields.push('Priority');
    if (result.labelIds) changedFields.push('Labels');
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={`sm:max-w-xl ${dialogBg}`}>
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${titleColor}`}>
            <SparklesIcon className={`size-5 ${iconColor}`} />
            Update ticket with AI
          </DialogTitle>
          <DialogDescription className={descColor}>
            Ask the agent to update this ticket. Describe what should change.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {!result && (
            <>
              <div className={`rounded-lg border ${mutedCard} p-3`}>
                <p className={`text-xs font-medium ${labelMuted}`}>Current ticket</p>
                <p className="text-sm font-semibold">{ticketTitle}</p>
                <div className="mt-1 flex gap-2">
                  <Badge variant="outline" className={`capitalize ${badgeOutline}`}>{ticketType}</Badge>
                  <Badge variant="outline" className={badgeOutline}>{priorityLabel(ticketPriority)}</Badge>
                </div>
              </div>

              <div className={`rounded-lg border ${panelBorder} ${panelBg}`}>
                <Textarea
                  value={prompt}
                  onChange={(e) => { setPrompt(e.target.value); if (e.target.value.trim()) setValidated(false); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void generate();
                    }
                  }}
                  placeholder="e.g. Update the description with the new API changes, change priority to urgent, add security label…"
                  className={`min-h-[80px] resize-none rounded-lg ${inputBg} border-0 focus-visible:ring-0 ${validated && needsPrompt ? 'ring-2 ring-red-500' : ''}`}
                  disabled={loading}
                  autoFocus
                />
                {validated && needsPrompt && (
                  <p className="mt-1 text-xs text-red-400">Describe what should change on this ticket</p>
                )}
              </div>
            </>
          )}

          {result && (
            <div className={`rounded-lg border ${panelBorder} ${panelBg} p-4`}>
              <div className="mb-3 flex items-center gap-2">
                <Badge variant="secondary" className={draftBadge}>
                  Changes
                </Badge>
                {changedFields.length > 0 && (
                  <span className={`text-xs ${descColor}`}>
                    Will update: {changedFields.join(', ')}
                  </span>
                )}
              </div>

              <p className={`text-xs mb-3 ${descColor}`}>{result.reasoning}</p>

              <div className="flex flex-col gap-3">
                {result.title && (
                  <div>
                    <Label className={`text-[11px] ${labelMuted}`}>New title</Label>
                    <p className="text-sm font-medium">{result.title}</p>
                  </div>
                )}
                {result.type && (
                  <div>
                    <Label className={`text-[11px] ${labelMuted}`}>New type</Label>
                    <Badge variant="outline" className={`mt-0.5 capitalize ${badgeOutline}`}>{result.type}</Badge>
                  </div>
                )}
                {result.priority !== undefined && (
                  <div>
                    <Label className={`text-[11px] ${labelMuted}`}>New priority</Label>
                    <Badge variant="outline" className={`mt-0.5 ${badgeOutline}`}>{priorityLabel(result.priority)}</Badge>
                  </div>
                )}
                {result.description && (
                  <div>
                    <Label className={`text-[11px] ${labelMuted}`}>New description</Label>
                    <p className={`mt-1 max-h-32 overflow-y-auto rounded-md border ${cardBg} p-2 text-sm whitespace-pre-wrap`}>
                      {result.description}
                    </p>
                  </div>
                )}
                {result.labelIds && (
                  <div>
                    <Label className={`text-[11px] ${labelMuted}`}>Updated labels</Label>
                    <span className={`text-xs ${labelMuted}`}>{result.labelIds.length} label(s)</span>
                  </div>
                )}
                {changedFields.length === 0 && (
                  <p className={`text-sm ${labelMuted}`}>No changes detected. Try a different instruction.</p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <button type="button" onClick={handleOpenChange.bind(null, false)} className={outlineBtn}>
            Cancel
          </button>
          {result ? (
            <>
              <button
                type="button"
                onClick={() => setResult(null)}
                className={violetOutlineBtn}
              >
                Refine
              </button>
              <Button
                onClick={apply}
                disabled={applying || changedFields.length === 0}
                className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700"
              >
                {applying ? (
                  <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
                ) : null}
                Apply changes
              </Button>
            </>
          ) : (
            <Button
              onClick={generate}
              disabled={loading}
              className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700 shadow-[0_0_15px_rgba(139,92,246,0.3)] transition-shadow hover:shadow-[0_0_25px_rgba(139,92,246,0.5)]"
            >
              {loading ? (
                <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
              ) : (
                <SparklesIcon data-icon="inline-start" />
              )}
              Generate
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
