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

  const reset = () => {
    setPrompt('');
    setResult(null);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const generate = async () => {
    if (!prompt.trim()) return;
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-violet-700">
            <SparklesIcon className="size-5 text-violet-500" />
            Update ticket with AI
          </DialogTitle>
          <DialogDescription>
            Ask the agent to update this ticket. Describe what should change.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {!result && (
            <>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">Current ticket</p>
                <p className="text-sm font-semibold">{ticketTitle}</p>
                <div className="mt-1 flex gap-2">
                  <Badge variant="outline" className="capitalize">{ticketType}</Badge>
                  <Badge variant="outline">{priorityLabel(ticketPriority)}</Badge>
                </div>
              </div>

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
                  placeholder="e.g. Update the description with the new API changes, change priority to urgent, add security label…"
                  className="min-h-[80px] resize-none border-violet-200 bg-white text-sm focus-visible:ring-violet-500"
                  disabled={loading}
                  autoFocus
                />
                <div className="mt-3 flex items-center justify-end">
                  <Button
                    onClick={generate}
                    disabled={!prompt.trim() || loading}
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
            </>
          )}

          {result && (
            <div className="rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50/50 to-fuchsia-50/50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Badge variant="secondary" className="bg-violet-100 text-violet-700 border-violet-200">
                  Changes
                </Badge>
                {changedFields.length > 0 && (
                  <span className="text-xs text-violet-600">
                    Will update: {changedFields.join(', ')}
                  </span>
                )}
              </div>

              <p className="text-xs text-violet-600 mb-3">{result.reasoning}</p>

              <div className="flex flex-col gap-3">
                {result.title && (
                  <div>
                    <Label className="text-[11px] text-muted-foreground">New title</Label>
                    <p className="text-sm font-medium">{result.title}</p>
                  </div>
                )}
                {result.type && (
                  <div>
                    <Label className="text-[11px] text-muted-foreground">New type</Label>
                    <Badge variant="outline" className="mt-0.5 capitalize">{result.type}</Badge>
                  </div>
                )}
                {result.priority !== undefined && (
                  <div>
                    <Label className="text-[11px] text-muted-foreground">New priority</Label>
                    <Badge variant="outline" className="mt-0.5">{priorityLabel(result.priority)}</Badge>
                  </div>
                )}
                {result.description && (
                  <div>
                    <Label className="text-[11px] text-muted-foreground">New description</Label>
                    <p className="mt-1 max-h-32 overflow-y-auto rounded-md border bg-white p-2 text-sm whitespace-pre-wrap">
                      {result.description}
                    </p>
                  </div>
                )}
                {result.labelIds && (
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Updated labels</Label>
                    <span className="text-xs text-muted-foreground">{result.labelIds.length} label(s)</span>
                  </div>
                )}
                {changedFields.length === 0 && (
                  <p className="text-sm text-muted-foreground">No changes detected. Try a different instruction.</p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleOpenChange.bind(null, false)}>
            Cancel
          </Button>
          {result && (
            <>
              <Button
                variant="outline"
                onClick={() => setResult(null)}
                className="border-violet-300 text-violet-700 hover:bg-violet-50"
              >
                Refine
              </Button>
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
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
