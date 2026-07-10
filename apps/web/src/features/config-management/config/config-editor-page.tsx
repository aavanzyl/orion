import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon } from 'lucide-react';
import type { Project } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { ConfigEditorSheet } from './config-editor-sheet';

export function ConfigEditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .getProject(projectId)
      .then(setProject)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (!projectId) {
    return <p className="p-6 text-destructive">Missing project id.</p>;
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="flex-1" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-destructive">{error ?? 'Project not found.'}</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/projects')}>
          <ArrowLeftIcon data-icon="inline-start" />
          Back to projects
        </Button>
      </div>
    );
  }

  return <ConfigEditorSheet project={project} onClose={() => navigate('/projects')} />;
}
