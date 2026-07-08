import { useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { PencilIcon, PlusIcon, ServerIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { Provider } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { useProviders } from './hooks';
import { ProviderFormDialog } from './provider-form-dialog';
import { BoardSyncSection } from '@/features/board-sync/board-sync-section';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api';

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { providers, loading: providersLoading, error: providersError, refetch } = useProviders();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<'name' | 'harness' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => setMounted(true), []);

  const toggleSort = (field: 'name' | 'harness') => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortArrow = ({ field }: { field: 'name' | 'harness' }) => {
    if (sortField !== field) return null;
    return <span className="ml-1 text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const filtered = useMemo(
    () =>
      searchQuery
        ? providers.filter(
            (p) =>
              p.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
              (p.label || '').toLowerCase().includes(searchQuery.toLowerCase())
          )
        : providers,
    [providers, searchQuery]
  );

  const sorted = useMemo(() => {
    if (!sortField) return filtered;
    return [...filtered].sort((a, b) => {
      let cmp: number;
      if (sortField === 'name') {
        cmp = (a.label || a.key).localeCompare(b.label || b.key);
      } else {
        cmp = (a.harness || '').localeCompare(b.harness || '');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (provider: Provider) => {
    setEditing(provider);
    setFormOpen(true);
  };

  const remove = async (provider: Provider) => {
    try {
      await api.deleteProvider(provider.id);
      toast.success('Provider removed');
      refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-card px-6 py-4">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure how the Orion board looks and connects.
        </p>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="general" className="mx-auto w-full max-w-4xl gap-6">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="board-sync">Board Sync</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="flex flex-col gap-6">
            <Card className="border-border/50 shadow-none">
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>Choose the board&apos;s color theme.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="theme-select">Theme</Label>
                  <Select
                    value={mounted ? (theme ?? 'system') : 'system'}
                    onValueChange={setTheme}
                  >
                    <SelectTrigger id="theme-select" className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-none">
              <CardHeader>
                <CardTitle>Connection</CardTitle>
                <CardDescription>
                  The orchestrator API the board talks to. Set <code>VITE_API_URL</code> to change
                  it.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4">
                  <Label>API URL</Label>
                  <code className="rounded-md bg-muted px-2.5 py-1 text-sm font-medium">{API_URL}</code>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="providers">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <ServerIcon className="size-4" />
                      Providers &amp; models
                    </CardTitle>
                    <CardDescription>
                      The AI providers and models available to your agents. These power
                      autocomplete when you fill in an agent in the config wizard.
                    </CardDescription>
                  </div>
                  <Button size="sm" onClick={openCreate}>
                    <PlusIcon data-icon="inline-start" />
                    Create provider
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {providersError ? (
                  <p className="text-sm text-destructive">{providersError}</p>
                ) : providersLoading ? (
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                  </div>
                ) : providers.length === 0 ? (
                  <div className="rounded-md border border-dashed p-6 text-center">
                    <p className="text-sm text-muted-foreground">
                      No providers yet. Create one (e.g. <code>codex</code>) so the wizard can
                      autocomplete providers and models.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Input
                      placeholder="Filter providers..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="max-w-xs"
                    />
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead
                            className="cursor-pointer select-none"
                            onClick={() => toggleSort('name')}
                          >
                            Name / Key
                            <SortArrow field="name" />
                          </TableHead>
                          <TableHead>Models</TableHead>
                          <TableHead
                            className="cursor-pointer select-none"
                            onClick={() => toggleSort('harness')}
                          >
                            Harness
                            <SortArrow field="harness" />
                          </TableHead>
                          <TableHead className="w-0">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sorted.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-muted-foreground">
                              No providers match your filter.
                            </TableCell>
                          </TableRow>
                        ) : (
                          sorted.map((provider) => (
                            <TableRow key={provider.id}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{provider.label || provider.key}</span>
                                  <Badge variant="secondary" className="font-mono">
                                    {provider.key}
                                  </Badge>
                                </div>
                                {provider.baseUrl && (
                                  <p className="mt-1 truncate text-xs text-muted-foreground">
                                    {provider.baseUrl}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {provider.models.length === 0 ? (
                                    <span className="text-xs text-muted-foreground">None</span>
                                  ) : (
                                    provider.models.map((model) => (
                                      <Badge key={model} variant="outline" className="font-mono">
                                        {model}
                                      </Badge>
                                    ))
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                {provider.harness ? (
                                  <Badge variant="outline" className="font-mono text-xs">
                                    {provider.harness}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">–</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={() => openEdit(provider)}
                                        aria-label={`Edit ${provider.key}`}
                                      >
                                        <PencilIcon />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Edit provider</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => remove(provider)}
                                        aria-label={`Delete ${provider.key}`}
                                      >
                                        <Trash2Icon />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Delete provider</TooltipContent>
                                  </Tooltip>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="board-sync">
            <BoardSyncSection />
          </TabsContent>
        </Tabs>
      </main>

      <ProviderFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        provider={editing}
        onSaved={refetch}
      />
    </div>
  );
}
