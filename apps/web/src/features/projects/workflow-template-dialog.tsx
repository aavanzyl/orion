import { useEffect, useState } from 'react';
import { CheckIcon, LayersIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkflowTemplateSummary } from '@orion/models';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { api, type WorkflowTemplateDetail } from '@/lib/api';

export interface WorkflowTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the fully-resolved template when the user applies one. */
  onApply: (detail: WorkflowTemplateDetail) => void;
}

export function WorkflowTemplateDialog({
  open,
  onOpenChange,
  onApply,
}: WorkflowTemplateDialogProps) {
  const [templates, setTemplates] = useState<WorkflowTemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelected(null);
    setLoading(true);
    api
      .listWorkflowTemplates()
      .then((res) => {
        setTemplates(res);
        setSelected(res[0]?.name ?? null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open]);

  const apply = async () => {
    if (!selected) return;
    setApplying(true);
    try {
      const detail = await api.getWorkflowTemplate(selected);
      onApply(detail);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start from a template</DialogTitle>
          <DialogDescription>
            Pick a ready-made workflow. Applying it replaces the <code>workflow:</code> block
            and adds any agents or swimlanes it needs. You still review and save the result.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : (
          <ScrollArea className="max-h-[24rem] pr-3">
            <div className="flex flex-col gap-2">
              {templates.map((template) => {
                const active = template.name === selected;
                return (
                  <button
                    key={template.name}
                    type="button"
                    onClick={() => setSelected(template.name)}
                    className={cn(
                      'flex flex-col gap-1.5 rounded-md border p-3 text-left transition-colors',
                      active
                        ? 'border-primary bg-accent'
                        : 'hover:border-foreground/30 hover:bg-accent/50',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <LayersIcon className="size-4 shrink-0 text-muted-foreground" />
                        {template.title}
                      </span>
                      {active && <CheckIcon className="size-4 shrink-0 text-primary" />}
                    </div>
                    <p className="text-xs text-muted-foreground">{template.description}</p>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      <Badge variant="secondary">{template.nodeCount} nodes</Badge>
                      {template.nodeTypes.map((type) => (
                        <Badge key={type} variant="outline" className="font-mono">
                          {type}
                        </Badge>
                      ))}
                      {template.tags?.map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={applying || !selected}>
            Insert template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
