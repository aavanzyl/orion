import { useState } from 'react';
import { toast } from 'sonner';
import type { Schedule } from '@orion/models';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';

export interface DeleteScheduleDialogProps {
  schedule: Schedule | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

export function DeleteScheduleDialog({ schedule, onOpenChange, onDeleted }: DeleteScheduleDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  const remove = async () => {
    if (!schedule) return;
    setSubmitting(true);
    try {
      await api.deleteSchedule(schedule.id);
      toast.success('Schedule removed');
      onOpenChange(false);
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(schedule)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete schedule</DialogTitle>
          <DialogDescription>
            Remove <strong>{schedule?.name}</strong>? This stops the agent from running on its cron
            schedule. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={remove} disabled={submitting}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
