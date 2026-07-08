import { useState } from 'react';
import { WrenchIcon } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SkillsSection } from '@/features/settings/skills-section';
import { useProjects } from '@/features/projects/hooks';

export function SkillsPage() {
  const { projects, loading: projectsLoading } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-card px-6 py-4">
        <h1 className="text-lg font-semibold">Skills</h1>
        <p className="text-sm text-muted-foreground">
          Manage the skills available to agents. Global skills are shared across all projects.
        </p>
      </header>
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto w-full max-w-6xl flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <WrenchIcon className="size-4" />
                Skill catalog
              </CardTitle>
              <CardDescription>
                Manage the skills available to agents. Built-in skills are always available.
                Install additional skills from GitHub repositories.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <Label htmlFor="skills-project" className="whitespace-nowrap">
                    Project scope
                  </Label>
                  {projectsLoading ? (
                    <Skeleton className="h-9 w-64" />
                  ) : (
                    <Select
                      value={selectedProjectId ?? '__global__'}
                      onValueChange={(v) =>
                        setSelectedProjectId(v === '__global__' ? null : v)
                      }
                    >
                      <SelectTrigger id="skills-project" className="w-72">
                        <SelectValue placeholder="Select scope…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__global__">Global (all projects)</SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
          {selectedProjectId ? (
            <SkillsSection
              key={selectedProjectId}
              projectId={selectedProjectId}
              global={false}
            />
          ) : (
            <SkillsSection global />
          )}
        </div>
      </main>
    </div>
  );
}
