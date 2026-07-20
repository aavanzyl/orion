import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileCodeIcon, PencilIcon, PlusIcon, Trash2Icon, WorkflowIcon } from 'lucide-react';
import type { Project } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProjects } from './hooks';
import { ProjectFormDialog } from './project-form-dialog';
import { ProjectWizard } from './project-wizard';
import { DeleteProjectDialog } from './delete-project-dialog';

const SOURCE_LABELS: Record<Project['sourceKind'], string> = {
  remote: 'Remote',
  local: 'Local',
  workspace: 'Workspace',
};

export function ProjectsPage() {
  const { projects, loading, error, refetch } = useProjects();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditing(project);
    setFormOpen(true);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Add, edit and remove the repositories Orion manages.
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon data-icon="inline-start" />
          New project
        </Button>
      </header>

      <main className="flex-1 overflow-auto p-6">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-muted-foreground">No projects yet.</p>
            <Button onClick={openCreate}>
              <PlusIcon data-icon="inline-start" />
              Add your first project
            </Button>
          </div>
        ) : (
          <div className="rounded-md border bg-card">
            <Table>
            <TableHeader className="bg-accent">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>URL / Path</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Config</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/projects/${project.id}`)}>
                  <TableCell className="font-medium">{project.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{SOURCE_LABELS[project.sourceKind]}</Badge>
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-muted-foreground">
                    {project.sourceKind === 'remote'
                      ? project.repoUrl || '\u2014'
                      : project.sourceKind === 'workspace' && project.paths && project.paths.length > 0
                        ? `${project.paths.length} folder${project.paths.length > 1 ? 's' : ''}`
                        : project.rootPath || '\u2014'}
                  </TableCell>
                  <TableCell>{project.defaultBranch}</TableCell>
                  <TableCell className="font-mono text-xs">{project.configPath}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); openEdit(project); }}>
                            <PencilIcon />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Edit project</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}/config`); }}
                          >
                            <FileCodeIcon />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Edit config</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}/builder`); }}
                          >
                            <WorkflowIcon />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Workflow builder</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setDeleting(project); }}
                          >
                            <Trash2Icon />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Delete project</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </main>

      <ProjectWizard
        open={formOpen && !editing}
        onOpenChange={(open) => {
          if (!open) setFormOpen(false);
        }}
        onSaved={refetch}
      />
      <ProjectFormDialog
        open={formOpen && !!editing}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditing(null);
          }
        }}
        project={editing}
        onSaved={refetch}
      />
      <DeleteProjectDialog
        project={deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        onDeleted={refetch}
      />
    </div>
  );
}
