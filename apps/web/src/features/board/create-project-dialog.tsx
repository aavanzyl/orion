import { useState } from 'react';
import { FolderPlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProjectFormDialog } from '@/features/projects/project-form-dialog';

export function CreateProjectDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" className="bg-card" onClick={() => setOpen(true)}>
        <FolderPlusIcon data-icon="inline-start" />
        New project
      </Button>
      <ProjectFormDialog open={open} onOpenChange={setOpen} onSaved={onCreated} />
    </>
  );
}
