import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { McpSection } from '@/features/settings/mcp-section';
import { useProjects } from '@/features/projects/hooks';

export function McpPage() {
  const { projects, loading: projectsLoading } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-card px-6 py-4">
        <h1 className="text-lg font-semibold">MCP</h1>
      </header>
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto w-full max-w-6xl flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <Label htmlFor="mcp-project" className="whitespace-nowrap">
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
                <SelectTrigger id="mcp-project" className="w-72">
                  <SelectValue placeholder="Select scope..." />
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
          {selectedProjectId ? (
            <McpSection
              key={selectedProjectId}
              projectId={selectedProjectId}
              global={false}
            />
          ) : (
            <McpSection global />
          )}
        </div>
      </main>
    </div>
  );
}
