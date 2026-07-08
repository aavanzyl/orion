import { useState } from 'react';
import { toast } from 'sonner';
import type { Project } from '@orion/models';
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

export interface DeleteProjectDialogProps {
  project: Project | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

export function DeleteProjectDialog({ project, onOpenChange, onDeleted }: DeleteProjectDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  const remove = async () => {
    if (!project) return;
    setSubmitting(true);
    try {
      await api.deleteProject(project.id);
      toast.success('Project deleted');
      onOpenChange(false);
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete project</DialogTitle>
          <DialogDescription>
            Remove <strong>{project?.name}</strong> from Orion? This deletes the project and its
            tickets from the board. Your source repository and its files are not touched.
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
