import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { useNavigate } from 'react-router-dom';
import {
  BookOpenIcon,
  BugIcon,
  FileCodeIcon,
  GitCommitHorizontalIcon,
  ImageIcon,
  InfoIcon,
  PencilIcon,
  PlusIcon,
  ServerIcon,
  Trash2Icon,
  WorkflowIcon,
  XIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Project, Provider, NotificationEventKey } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
import { Separator } from '@/components/ui/separator';
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
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  api,
  getApiBaseUrl,
  getDefaultApiBaseUrl,
  pingApi,
  setApiBaseUrl,
} from '@/lib/api';
import { ACCENT_PRESETS, useBranding, type AccentKey } from '@/lib/use-branding';
import { usePreferences } from '@/lib/use-preferences';
import { useProviders } from './hooks';
import { ProviderFormDialog } from './provider-form-dialog';
import { McpClientConnectCard } from './mcp-shared';
import { BoardSyncSection } from '@/features/board-sync/board-sync-section';
import { useProjects } from '@/features/projects/hooks';
import { ProjectFormDialog } from '@/features/projects/project-form-dialog';
import { ProjectWizard } from '@/features/projects/project-wizard';
import { DeleteProjectDialog } from '@/features/projects/delete-project-dialog';

const HARNESS_OPTIONS = ['codex', 'claude', 'opencode'];
const REPO_URL = 'https://github.com/aavanzyl/orion';
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.0.0';
const APP_GIT_SHA = import.meta.env.VITE_APP_GIT_SHA ?? 'unknown';
const APP_BUILD_TIME = import.meta.env.VITE_APP_BUILD_TIME ?? '';

const MAX_LOGO_SIZE = 512 * 1024;

const NONE = '__none__';

function LogoUploadButton({ onUpload }: { onUpload: (dataUrl: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOGO_SIZE) {
      toast.error('Logo must be under 512 KB.');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUpload(reader.result);
      }
    };
    reader.onerror = () => {
      toast.error('Failed to read logo file.');
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
        id="logo-upload"
      />
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} type="button">
        <ImageIcon data-icon="inline-start" />
        Upload
      </Button>
    </>
  );
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const { providers, loading: providersLoading, error: providersError, refetch } = useProviders();
  const { branding, setBranding } = useBranding();
  const { preferences, setAgentDefaults, setNotificationEvent, setIssueTypeDefaults } = usePreferences();
  const issueTypeDefaults = preferences.issueTypeDefaults;
  const [brandingDraft, setBrandingDraft] = useState(branding.title);
  const [apiUrlDraft, setApiUrlDraft] = useState(getApiBaseUrl());
  const [testing, setTesting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<'name' | 'harness' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const { projects, loading: projectsLoading, error: projectsError, refetch: refetchProjects } = useProjects();
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

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

  const [deletingProvider, setDeletingProvider] = useState<Provider | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (provider: Provider) => {
    setEditing(provider);
    setFormOpen(true);
  };

  const remove = async () => {
    if (!deletingProvider) return;
    try {
      await api.deleteProvider(deletingProvider.id);
      toast.success('Provider removed');
      refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const { agentDefaults } = preferences;

  const handleDesktopToggle = async (eventKey: string, enabled: boolean) => {
    if (enabled && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast.error('Desktop notifications were blocked by the browser.');
        return;
      }
    }
    setNotificationEvent(eventKey as Parameters<typeof setNotificationEvent>[0], { desktop: enabled });
  };

  const selectedProvider = providers.find((p) => p.id === agentDefaults.providerId) ?? null;

  const saveApiUrl = () => {
    const trimmed = apiUrlDraft.trim();
    setApiBaseUrl(trimmed || null);
    setApiUrlDraft(getApiBaseUrl());
    toast.success('API URL saved. Reload the page to apply it everywhere.');
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const ok = await pingApi(apiUrlDraft.trim() || undefined);
      if (ok) {
        toast.success('Connected to the orchestrator.');
      } else {
        toast.error('Could not reach the orchestrator.');
      }
    } finally {
      setTesting(false);
    }
  };

  const numberField = (value: number, onChange: (n: number) => void, min: number) => (
    <Input
      type="number"
      min={min}
      className="w-24"
      value={value}
      onChange={(e) => {
        const next = Number(e.target.value);
        onChange(Number.isNaN(next) ? min : Math.max(min, next));
      }}
    />
  );

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
            <TabsTrigger value="projects">Projects</TabsTrigger>
            <TabsTrigger value="board-sync">Board Sync</TabsTrigger>
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="mcp">MCP</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="issueTypes">Issue Types</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="flex flex-col gap-6">
            <Card className="border-border/50 shadow-none">
              <CardHeader>
                <CardTitle>Appearance &amp; Branding</CardTitle>
                <CardDescription>
                  Customize the board&apos;s theme, accent color, title, and logo.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
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
                <div className="flex items-center justify-between gap-4">
                  <Label>Accent color</Label>
                  <div className="flex items-center gap-2">
                    {(Object.entries(ACCENT_PRESETS) as [AccentKey, { label: string; hue: number }][]).map(
                      ([key, preset]) => (
                        <Tooltip key={key}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={preset.label}
                              onClick={() => setBranding({ accent: key })}
                              className={cn(
                                'size-6 rounded-full border transition-transform hover:scale-110',
                                branding.accent === key
                                  ? 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                                  : 'border-border'
                              )}
                              style={{ backgroundColor: `oklch(0.6 0.16 ${preset.hue})` }}
                            />
                          </TooltipTrigger>
                          <TooltipContent>{preset.label}</TooltipContent>
                        </Tooltip>
                      )
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="branding-title">Application Title</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="branding-title"
                      className="w-48"
                      value={brandingDraft}
                      onChange={(e) => setBrandingDraft(e.target.value)}
                      onBlur={() => {
                        const trimmed = brandingDraft.trim();
                        if (trimmed && trimmed !== branding.title) {
                          setBranding({ title: trimmed });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      placeholder="Orion"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label>Logo</Label>
                    <p className="text-xs text-muted-foreground">
                      Upload a custom logo (PNG, JPEG, SVG; max 512 KB).
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {branding.logo ? (
                      <div className="flex items-center gap-2">
                        <img
                          src={branding.logo}
                          alt="Logo preview"
                          className="size-8 rounded object-contain"
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setBranding({ logo: null })}
                          aria-label="Remove custom logo"
                        >
                          <XIcon />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                        <img src="/orion-mark.svg" alt="Default logo" className="size-4" />
                      </div>
                    )}
                    <LogoUploadButton onUpload={(dataUrl) => setBranding({ logo: dataUrl })} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 shadow-none">
              <CardHeader>
                <CardTitle>Connection</CardTitle>
                <CardDescription>
                  The orchestrator API the board talks to. Overrides the <code>VITE_API_URL</code>{' '}
                  build setting.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="api-url">API URL</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="api-url"
                      className="w-72"
                      value={apiUrlDraft}
                      onChange={(e) => setApiUrlDraft(e.target.value)}
                      placeholder={getDefaultApiBaseUrl()}
                    />
                    <Button variant="outline" onClick={testConnection} disabled={testing}>
                      {testing ? 'Testing…' : 'Test'}
                    </Button>
                    <Button onClick={saveApiUrl}>Save</Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Default: <code>{getDefaultApiBaseUrl()}</code>
                </p>
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
                                        onClick={() => setDeletingProvider(provider)}
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

          <TabsContent value="agents">
            <Card className="border-border/50 shadow-none">
              <CardHeader>
                <CardTitle>Agent defaults</CardTitle>
                <CardDescription>
                  Defaults applied to new runs and workflow nodes that don&apos;t specify their own
                  provider or limits.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="default-provider">Default provider</Label>
                  <Select
                    value={agentDefaults.providerId || NONE}
                    onValueChange={(v) =>
                      setAgentDefaults({ providerId: v === NONE ? '' : v, model: '' })
                    }
                  >
                    <SelectTrigger id="default-provider" className="w-64">
                      <SelectValue placeholder="Select a provider…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label || p.key}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="default-model">Default model</Label>
                  <Select
                    value={agentDefaults.model || NONE}
                    onValueChange={(v) => setAgentDefaults({ model: v === NONE ? '' : v })}
                    disabled={!selectedProvider || selectedProvider.models.length === 0}
                  >
                    <SelectTrigger id="default-model" className="w-64">
                      <SelectValue placeholder="Select a model…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {selectedProvider?.models.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="default-harness">Default harness</Label>
                  <Select
                    value={agentDefaults.harness || NONE}
                    onValueChange={(v) => setAgentDefaults({ harness: v === NONE ? '' : v })}
                  >
                    <SelectTrigger id="default-harness" className="w-64">
                      <SelectValue placeholder="Auto" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Auto</SelectItem>
                      {HARNESS_OPTIONS.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label>Max concurrent runs</Label>
                    <p className="text-xs text-muted-foreground">
                      How many runs may execute at the same time.
                    </p>
                  </div>
                  {numberField(
                    agentDefaults.concurrency,
                    (n) => setAgentDefaults({ concurrency: n }),
                    1
                  )}
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label>Run timeout (seconds)</Label>
                    <p className="text-xs text-muted-foreground">
                      Abort a run if it exceeds this duration.
                    </p>
                  </div>
                  {numberField(
                    agentDefaults.timeoutSeconds,
                    (n) => setAgentDefaults({ timeoutSeconds: n }),
                    0
                  )}
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label>Max retries</Label>
                    <p className="text-xs text-muted-foreground">
                      Automatic retry attempts for failed runs.
                    </p>
                  </div>
                  {numberField(
                    agentDefaults.maxRetries,
                    (n) => setAgentDefaults({ maxRetries: n }),
                    0
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="issueTypes">
            <Card className="border-border/50 shadow-none">
              <CardHeader>
                <CardTitle>Default issue types</CardTitle>
                <CardDescription>
                  Default ticket types applied to new projects. Each type maps to a workflow.
                  &quot;epic&quot; is always available regardless of configuration.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {issueTypeDefaults.length > 0 && (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Label</TableHead>
                          <TableHead>Workflow</TableHead>
                          <TableHead>Color</TableHead>
                          <TableHead>Icon</TableHead>
                          <TableHead className="w-0" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {issueTypeDefaults.map((it, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              <Input
                                value={it.name}
                                onChange={(e) => {
                                  const next = [...issueTypeDefaults];
                                  const newName = e.target.value;
                                  next[i] = {
                                    ...next[i],
                                    name: newName,
                                    label: next[i].label || (newName ? newName.charAt(0).toUpperCase() + newName.slice(1) : ''),
                                  };
                                  setIssueTypeDefaults(next);
                                }}
                                placeholder="feature"
                                className="font-mono text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={it.label}
                                onChange={(e) => {
                                  const next = [...issueTypeDefaults];
                                  next[i] = { ...next[i], label: e.target.value };
                                  setIssueTypeDefaults(next);
                                }}
                                placeholder="Feature"
                                className="text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={it.workflow}
                                onChange={(e) => {
                                  const next = [...issueTypeDefaults];
                                  next[i] = { ...next[i], workflow: e.target.value };
                                  setIssueTypeDefaults(next);
                                }}
                                placeholder="default"
                                className="font-mono text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={it.color ?? ''}
                                onChange={(e) => {
                                  const next = [...issueTypeDefaults];
                                  next[i] = { ...next[i], color: e.target.value || undefined };
                                  setIssueTypeDefaults(next);
                                }}
                                placeholder="#3b82f6"
                                className="w-24 font-mono text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={it.icon ?? ''}
                                onChange={(e) => {
                                  const next = [...issueTypeDefaults];
                                  next[i] = { ...next[i], icon: e.target.value || undefined };
                                  setIssueTypeDefaults(next);
                                }}
                                placeholder="BugIcon"
                                className="w-24 font-mono text-xs"
                              />
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() =>
                                  setIssueTypeDefaults(issueTypeDefaults.filter((_, j) => j !== i))
                                }
                                aria-label="Remove issue type"
                              >
                                <XIcon />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <div className="mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setIssueTypeDefaults([
                        ...issueTypeDefaults,
                        { name: '', label: '', workflow: 'default' },
                      ])
                    }
                  >
                    <PlusIcon data-icon="inline-start" />
                    Add type
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="mcp">
            <McpClientConnectCard />
          </TabsContent>

          <TabsContent value="board-sync">
            <BoardSyncSection />
          </TabsContent>

          <TabsContent value="notifications">
            <Card className="border-border/50 shadow-none">
              <CardHeader>
                <CardTitle>Notifications</CardTitle>
                <CardDescription>
                  Choose which events trigger notifications on each channel.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="py-2 pr-4 text-left text-sm font-medium" />
                      <th className="px-4 py-2 text-center text-sm font-medium">
                        <span className="flex items-center justify-center gap-1.5">
                          In-app Toasts
                        </span>
                      </th>
                      <th className="px-4 py-2 text-center text-sm font-medium">
                        <span className="flex items-center justify-center gap-1.5">
                          Desktop
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {([
                      { key: '__workflow_header', label: 'Workflow Events' },
                      { key: 'runComplete', label: 'A run completes' },
                      { key: 'runFailed', label: 'A run fails' },
                      { key: 'workflowTriggered', label: 'A workflow is triggered' },
                      { key: '__agent_header', label: 'Agent Events' },
                      { key: 'agentRunning', label: 'An agent starts running' },
                      { key: 'agentFailed', label: 'An agent fails' },
                      { key: '__schedule_header', label: 'Schedule Events' },
                      { key: 'scheduleFired', label: 'A scheduled agent fires' },
                      { key: 'scheduleCompleted', label: 'A scheduled agent completes' },
                      { key: 'scheduleFailed', label: 'A scheduled agent fails' },
                      { key: '__sync_header', label: 'Sync & Other' },
                      { key: 'syncComplete', label: 'A board sync completes' },
                      { key: 'sync.completed', label: 'Board sync completed' },
                      { key: 'sync.failed', label: 'Board sync failed' },
                      { key: 'approvalRequired', label: 'A run needs approval' },
                      { key: 'transitionIssue', label: 'A transition issue occurs' },
                      { key: 'nodeTransition', label: 'A node transitions state' },
                    ] as const).map(({ key, label }) => {
                      if (key.startsWith('__')) {
                        return (
                          <tr key={key} className="bg-muted/30">
                            <td className="py-2 pr-4 text-sm font-semibold text-foreground/70" colSpan={3}>
                              {label}
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={key} className="hover:bg-muted/30">
                          <td className="py-3 pr-4 text-sm">{label}</td>
                          <td className="px-4 py-3 text-center">
                            <Switch
                              id={`notif-${key}-toasts`}
                              checked={preferences.notifications.events[key as NotificationEventKey].toasts}
                              onCheckedChange={(v) => setNotificationEvent(key as NotificationEventKey, { toasts: v })}
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Switch
                              id={`notif-${key}-desktop`}
                              checked={preferences.notifications.events[key as NotificationEventKey].desktop}
                              onCheckedChange={(v) => handleDesktopToggle(key as NotificationEventKey, v)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="projects">
            <Card className="border-border/50 shadow-none">
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Projects</CardTitle>
                  <CardDescription>
                    Add, edit, and remove the repositories Orion manages.
                  </CardDescription>
                </div>
                <Button onClick={() => { setEditingProject(null); setProjectFormOpen(true); }}>
                  <PlusIcon data-icon="inline-start" />
                  New project
                </Button>
              </CardHeader>
              <CardContent>
                {projectsError ? (
                  <p className="text-destructive">{projectsError}</p>
                ) : projectsLoading ? (
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : projects.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-16 text-center">
                    <p className="text-muted-foreground">No projects yet.</p>
                    <Button onClick={() => { setEditingProject(null); setProjectFormOpen(true); }}>
                      <PlusIcon data-icon="inline-start" />
                      Add your first project
                    </Button>
                  </div>
                ) : (
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
                        <TableRow key={project.id}>
                          <TableCell className="font-medium">{project.name}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {project.sourceKind === 'remote' ? 'Remote' : project.sourceKind === 'workspace' ? 'Workspace' : 'Local'}
                            </Badge>
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
                                  <Button variant="ghost" size="icon-sm" onClick={() => { setEditingProject(project); setProjectFormOpen(true); }}>
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
                                    onClick={() => navigate(`/projects/${project.id}/config`)}
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
                                    onClick={() => navigate(`/projects/${project.id}/builder`)}
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
                                    onClick={() => setDeletingProject(project)}
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
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="about">
            <Card className="border-border/50 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <InfoIcon className="size-4" />
                  About {branding.title}
                </CardTitle>
                <CardDescription>Version and build information for this instance.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Version</span>
                  <Badge variant="secondary" className="font-mono">
                    v{APP_VERSION}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Commit</span>
                  <span className="flex items-center gap-1.5 font-mono">
                    <GitCommitHorizontalIcon className="size-3.5" />
                    {APP_GIT_SHA}
                  </span>
                </div>
                {APP_BUILD_TIME && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Built</span>
                    <span className="font-mono">{new Date(APP_BUILD_TIME).toLocaleString()}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">API URL</span>
                  <code className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium">
                    {getApiBaseUrl()}
                  </code>
                </div>

                <Separator />

                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a href={REPO_URL} target="_blank" rel="noreferrer">
                      <BookOpenIcon data-icon="inline-start" />
                      Documentation
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
                      <BugIcon data-icon="inline-start" />
                      Report an issue
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <ProviderFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        provider={editing}
        onSaved={refetch}
      />

      <ConfirmDialog
        open={deletingProvider !== null}
        onOpenChange={(open) => { if (!open) setDeletingProvider(null); }}
        title="Delete provider"
        description={`Remove ${deletingProvider?.key}? This may break agents that depend on this provider.`}
        onConfirm={remove}
      />

      <ProjectWizard
        open={projectFormOpen && !editingProject}
        onOpenChange={(open) => {
          if (!open) setProjectFormOpen(false);
        }}
        onSaved={refetchProjects}
      />
      <ProjectFormDialog
        open={projectFormOpen && !!editingProject}
        onOpenChange={(open) => {
          if (!open) {
            setProjectFormOpen(false);
            setEditingProject(null);
          }
        }}
        project={editingProject}
        onSaved={refetchProjects}
      />
      <DeleteProjectDialog
        project={deletingProject}
        onOpenChange={(open) => !open && setDeletingProject(null)}
        onDeleted={refetchProjects}
      />
    </div>
  );
}
