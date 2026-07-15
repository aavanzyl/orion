import { useCallback, useEffect, useRef, useState } from 'react';
import { DatabaseIcon, GitBranchIcon, PackageIcon, RefreshCwIcon, SearchIcon } from 'lucide-react';
import type { CodeIndex, SearchResult } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { useProjects } from '@/features/projects/hooks';

const STATUS_VARIANT: Record<string, 'default' | 'destructive' | 'outline' | 'secondary' | 'success' | 'warning' | 'info'> = {
  idle: 'outline',
  indexing: 'info',
  ready: 'success',
  error: 'destructive',
};

const POLL_INTERVAL_MS = 3000;

export function CodebasePage() {
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState<string>('');
  const [index, setIndex] = useState<CodeIndex | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId]);

  const fetchStatus = useCallback(async () => {
    if (!projectId) return;
    try {
      const status = await api.getCodeIndex(projectId);
      setIndex(status);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    setLoadingStatus(true);
    setResults([]);
    setSearched(false);
    fetchStatus().finally(() => setLoadingStatus(false));
  }, [projectId, fetchStatus]);

  useEffect(() => {
    if (index?.status === 'indexing') {
      pollRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
    return undefined;
  }, [index?.status, fetchStatus]);

  const handleReindex = async () => {
    if (!projectId) return;
    try {
      const status = await api.reindexCodebase(projectId);
      setIndex(status);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSearch = async () => {
    if (!projectId || !query.trim()) return;
    setSearching(true);
    setSearched(true);
    try {
      const hits = await api.searchCodebase(projectId, query.trim());
      setResults(hits);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const isIndexing = index?.status === 'indexing';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Codebase</h1>
          <p className="text-sm text-muted-foreground">
            Index a project's repository and search it semantically.
          </p>
        </div>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select a project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      <div className="flex items-center justify-between gap-4 border-b px-6 py-3">
        {loadingStatus ? (
          <Skeleton className="h-6 w-64" />
        ) : index ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">Status:</span>
              <Badge variant={STATUS_VARIANT[index.status] ?? 'outline'}>{index.status}</Badge>
            </span>
            <span className="text-muted-foreground">
              {index.fileCount} files · {index.chunkCount} chunks
            </span>
            {index.provider && (
              <span className="text-muted-foreground">Provider: {index.provider}</span>
            )}
            {index.lastIndexedAt && (
              <span className="text-muted-foreground">
                Indexed {new Date(index.lastIndexedAt).toLocaleString()}
              </span>
            )}
            {index.error && <span className="text-destructive">{index.error}</span>}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Select a project to begin.</span>
        )}
        <div className="flex items-center gap-2">
          {index?.status === 'ready' && (
            <>
              <Button variant="ghost" size="sm" asChild>
                <a href={`/codebase-graph`}>
                  <GitBranchIcon className="size-3.5" />
                  Call Graph
                </a>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <a href={`/codegen-graph`}>
                  <PackageIcon className="size-3.5" />
                  Projects
                </a>
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={handleReindex} disabled={!projectId || isIndexing}>
            <RefreshCwIcon className={`size-4 ${isIndexing ? 'animate-spin' : ''}`} />
            {isIndexing ? 'Indexing…' : 'Reindex'}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b px-6 py-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the codebase…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
          disabled={!projectId}
        />
        <Button size="sm" onClick={handleSearch} disabled={!projectId || !query.trim() || searching}>
          <SearchIcon className="size-4" />
          Search
        </Button>
      </div>

      <main className="flex-1 overflow-auto p-6">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : searching ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : results.length > 0 ? (
          <div className="flex flex-col gap-3">
            {results.map((r, i) => (
              <div key={`${r.filePath}-${r.startLine}-${i}`} className="rounded-md border">
                <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
                  <span className="font-mono text-xs">
                    {r.filePath}:{r.startLine}-{r.endLine}
                  </span>
                  <Badge variant="secondary">{r.score.toFixed(3)}</Badge>
                </div>
                <pre className="max-h-64 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
                  {r.snippet}
                </pre>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <DatabaseIcon className="size-8 text-muted-foreground" />
            <p className="text-muted-foreground">
              {searched
                ? 'No results found.'
                : index?.status === 'ready'
                  ? 'Enter a query to search the indexed codebase.'
                  : 'Reindex this project to enable search.'}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
