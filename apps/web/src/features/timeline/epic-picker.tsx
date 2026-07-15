import { useEffect, useState } from 'react';
import { PlusIcon, TrashIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Epic, EpicId } from '@orion/models';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { api } from '@/lib/api';

interface EpicPickerProps {
  projectId: string | null;
  value?: EpicId | null;
  onChange?: (epicId: EpicId | null) => void;
  /** When true, shows a button to create/manage epics. Default true. */
  showManage?: boolean;
  className?: string;
  placeholder?: string;
}

export function EpicPicker({
  projectId,
  value,
  onChange,
  showManage = true,
  className,
  placeholder = 'No epic',
}: EpicPickerProps) {
  const [epics, setEpics] = useState<Epic[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createColor, setCreateColor] = useState('#7c3aed');
  const [deletingEpicId, setDeletingEpicId] = useState<EpicId | null>(null);

  useEffect(() => {
    if (!projectId) {
      setEpics([]);
      return;
    }
    api
      .listEpics(projectId)
      .then(setEpics)
      .catch(() => undefined);
  }, [projectId]);

  const createEpic = async () => {
    if (!projectId || !createTitle.trim()) return;
    try {
      const epic = await api.createEpic(projectId, { title: createTitle.trim(), color: createColor });
      setEpics((prev) => [...prev, epic].sort((a, b) => a.title.localeCompare(b.title)));
      setCreateTitle('');
      setCreateOpen(false);
      onChange?.(epic.id);
      toast.success('Epic created');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const deleteEpic = async (id: EpicId) => {
    try {
      await api.deleteEpic(id);
      setEpics((prev) => prev.filter((e) => e.id !== id));
      if (value === id) onChange?.(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const confirmDeleteEpic = async () => {
    if (!deletingEpicId) return;
    await deleteEpic(deletingEpicId);
  };

  return (
    <>
      <Select
        value={value ?? ''}
        onValueChange={(v) => onChange?.(v || null)}
      >
        <SelectTrigger className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{placeholder}</SelectItem>
          {epics.map((epic) => (
            <SelectItem key={epic.id} value={epic.id}>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm shrink-0" style={{ backgroundColor: epic.color }} />
                {epic.title}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showManage && projectId && (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => setCreateOpen(true)}
          >
            <PlusIcon className="mr-1 size-3" />
            Epic
          </Button>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create epic</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Title</Label>
              <Input
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="e.g. Onboarding v2"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createEpic();
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={createColor}
                  onChange={(e) => setCreateColor(e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded border"
                />
                <span className="text-xs text-muted-foreground">{createColor}</span>
              </div>
            </div>
            <div className="border-t pt-3">
              <Label className="mb-2 block text-xs text-muted-foreground">Existing epics</Label>
              <div className="flex flex-col gap-1 max-h-32 overflow-auto">
                {epics.map((epic) => (
                  <div key={epic.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-sm shrink-0" style={{ backgroundColor: epic.color }} />
                      {epic.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDeletingEpicId(epic.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${epic.title}`}
                    >
                      <TrashIcon className="size-3" />
                    </button>
                  </div>
                ))}
                {epics.length === 0 && (
                  <p className="text-xs text-muted-foreground">No epics yet.</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={createEpic} disabled={!createTitle.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deletingEpicId !== null}
        onOpenChange={(open) => { if (!open) setDeletingEpicId(null); }}
        title="Delete epic"
        description="This will remove the epic. Tickets assigned to it will no longer be associated."
        onConfirm={confirmDeleteEpic}
      />
    </>
  );
}
