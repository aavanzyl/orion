import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DownloadIcon,
  Trash2Icon,
  WrenchIcon,
  AlertTriangleIcon,
  ShieldIcon,
  EyeIcon,
  RefreshCwIcon,
  ExternalLinkIcon,
  PencilIcon,
  CheckIcon,
  XIcon,
  SearchIcon,
  ArrowUpDownIcon,
} from 'lucide-react';
import type { RecommendedSkill, SkillCatalogEntry, SkillDetail, SkillReference } from '@orion/models';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Markdown } from '@/components/markdown';
import { toast } from 'sonner';

interface SkillsSectionProps {
  projectId?: string;
  /** When true, uses global skill API endpoints. Default true. */
  global?: boolean;
}

type SortField = 'name' | 'lastSyncedAt';
type SortDir = 'asc' | 'desc';

function formatDate(iso?: string): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sourceLink(sourceUrl?: string): string | null {
  if (!sourceUrl) return null;
  if (sourceUrl.startsWith('https://github.com/')) {
    return sourceUrl.replace(/\.git$/, '');
  }
  return sourceUrl;
}

interface ParsedFrontmatter {
  fields: Record<string, string | string[]>;
  body: string;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return { fields: {}, body: content };
  const yaml = match[1];
  const body = content.slice(match[0].length);
  const fields: Record<string, string | string[]> = {};
  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key || !value) continue;
    // Parse YAML list like [plan, review]
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1);
      fields[key] = inner.split(',').map((v) => v.trim().replace(/['"]/g, '')).filter(Boolean);
    } else {
      fields[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
  return { fields, body };
}

export function SkillsSection({ projectId, global = true }: SkillsSectionProps) {
  const [skills, setSkills] = useState<SkillCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Install dialog
  const [installOpen, setInstallOpen] = useState(false);
  const [installTab, setInstallTab] = useState<'recommended' | 'github'>('recommended');
  const [source, setSource] = useState('');
  const [skillPath, setSkillPath] = useState('');
  const [ref, setRef] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [syncInstall, setSyncInstall] = useState(true);
  const [installing, setInstalling] = useState(false);

  // Recommended catalog
  const [recommended, setRecommended] = useState<RecommendedSkill[]>([]);
  const [recommendedLoading, setRecommendedLoading] = useState(false);
  const [installingName, setInstallingName] = useState<string | null>(null);

  // View detail dialog
  const [viewOpen, setViewOpen] = useState(false);
  const [viewSkill, setViewSkill] = useState<SkillDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  // Delete confirmation
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSkill, setDeleteSkill] = useState<SkillCatalogEntry | null>(null);
  const [deleteRefs, setDeleteRefs] = useState<SkillReference[]>([]);
  const [deleteRefsLoading, setDeleteRefsLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Syncing state
  const [syncing, setSyncing] = useState<Set<string>>(new Set());

  // Inline tag editing
  const [editingTags, setEditingTags] = useState<string | null>(null);
  const [editTagsValue, setEditTagsValue] = useState('');

  // Sorting and filtering
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filterText, setFilterText] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const promise = global
      ? api.listGlobalSkills()
      : api.listSkills((projectId ?? ''));
    promise
      .then((res) => setSkills(res.skills))
      .catch(() => toast.error('Failed to load skills'))
      .finally(() => setLoading(false));
  }, [projectId, global]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!installOpen || recommended.length > 0) return;
    setRecommendedLoading(true);
    api
      .listRecommendedSkills()
      .then((res) => setRecommended(res.skills))
      .catch(() => toast.error('Failed to load recommended skills'))
      .finally(() => setRecommendedLoading(false));
  }, [installOpen, recommended.length]);

  const installedNames = useMemo(
    () => new Set(skills.filter((s) => s.source === 'project').map((s) => s.name)),
    [skills],
  );

  const runInstall = async (
    input: Parameters<typeof api.installGlobalSkill>[0],
  ): Promise<boolean> => {
    const result = global
      ? await api.installGlobalSkill(input)
      : await api.installSkill(projectId ?? '', input);
    const names = result.skills.map((s) => s.name).join(', ');
    let message = `Installed ${names}`;
    if (result.scan.scanned) {
      if (result.scan.issueCount && result.scan.issueCount > 0) {
        message += ` — scan found ${result.scan.issueCount} potential issue(s).`;
      } else {
        message += ' — scan passed with no issues.';
      }
    } else {
      message += ' — security scan was unavailable.';
    }
    toast.success(message, { duration: 8000 });
    return true;
  };

  const installRecommended = async (skill: RecommendedSkill) => {
    setInstallingName(skill.name);
    try {
      await runInstall({
        source: skill.source,
        skillPath: skill.skillPath,
        ref: skill.ref,
        ...(skill.tags?.length ? { tags: skill.tags } : {}),
        scope: global ? ('global' as const) : ('project' as const),
        syncEnabled: true,
      });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setInstallingName(null);
    }
  };

  const view = async (name: string) => {
    setViewLoading(true);
    setViewOpen(true);
    try {
      const detail = global
        ? await api.getGlobalSkill(name)
        : await api.getSkill((projectId ?? ''), name);
      setViewSkill(detail);
    } catch {
      toast.error(`Failed to load skill "${name}"`);
      setViewOpen(false);
    } finally {
      setViewLoading(false);
    }
  };

  const install = async () => {
    if (!source.trim() || !skillPath.trim()) return;
    setInstalling(true);
    try {
      const tagList = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await runInstall({
        source: source.trim(),
        skillPath: skillPath.trim(),
        ref: ref.trim() || undefined,
        ...(tagList.length > 0 ? { tags: tagList } : {}),
        scope: global ? ('global' as const) : ('project' as const),
        syncEnabled: syncInstall,
      });
      setInstallOpen(false);
      setSource('');
      setSkillPath('');
      setRef('');
      setTagsInput('');
      setSyncInstall(true);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  const confirmDelete = async (skill: SkillCatalogEntry) => {
    setDeleteSkill(skill);
    setDeleteOpen(true);
    setDeleteRefsLoading(true);
    if (projectId && !global) {
      try {
        const res = await api.getSkillReferences(projectId, skill.name);
        setDeleteRefs(res.references);
      } catch {
        setDeleteRefs([]);
      }
    } else {
      setDeleteRefs([]);
    }
    setDeleteRefsLoading(false);
  };

  const doDelete = async () => {
    if (!deleteSkill) return;
    setDeleting(true);
    try {
      if (global) {
        await api.uninstallGlobalSkill(deleteSkill.name);
      } else {
        await api.uninstallSkill((projectId ?? ''), deleteSkill.name);
      }
      toast.success(`Uninstalled ${deleteSkill.name}`);
      setDeleteOpen(false);
      setDeleteSkill(null);
      setDeleteRefs([]);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const toggleSync = async (skill: SkillCatalogEntry) => {
    try {
      const input = { syncEnabled: !skill.syncEnabled };
      if (global) {
        await api.updateGlobalSkill(skill.name, input);
      } else {
        await api.updateSkill((projectId ?? ''), skill.name, input);
      }
      load();
      toast.success(
        skill.syncEnabled
          ? `Sync disabled for ${skill.name}`
          : `Sync enabled for ${skill.name}`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const doSync = async (name: string) => {
    setSyncing((prev) => new Set(prev).add(name));
    try {
      const result = global
        ? await api.syncGlobalSkill(name)
        : await api.syncSkill((projectId ?? ''), name);
      if (result.success) {
        toast.success(
          result.updated
            ? `Synced ${name} — updated to latest.`
            : `Synced ${name} — already up to date.`,
        );
      } else {
        toast.error(`Sync failed: ${result.error}`);
      }
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  };

  const startEditTags = (skill: SkillCatalogEntry) => {
    setEditingTags(skill.name);
    setEditTagsValue(skill.tags?.join(', ') ?? '');
  };

  const saveTags = async () => {
    if (!editingTags) return;
    const tags = editTagsValue
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      if (global) {
        await api.updateGlobalSkill(editingTags, { tags });
      } else {
        await api.updateSkill((projectId ?? ''), editingTags, { tags });
      }
      toast.success(`Tags updated for ${editingTags}`);
      setEditingTags(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortedAndFiltered = useMemo(() => {
    let list = [...skills];

    // Filter by text
    if (filterText) {
      const q = filterText.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags?.some((t) => t.toLowerCase().includes(q)),
      );
    }

    // Sort
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'lastSyncedAt':
          cmp = (a.lastSyncedAt ?? '').localeCompare(b.lastSyncedAt ?? '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [skills, filterText, sortField, sortDir]);

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDownIcon className="ml-1 size-3 opacity-30" />;
    return <ArrowUpDownIcon className="ml-1 size-3" />;
  };

  const scopeBadge = (scope?: string) => {
    if (!scope) return <span className="text-xs text-muted-foreground">&mdash;</span>;
    return (
      <Badge variant={scope === 'global' ? 'secondary' : 'outline'} className="text-[10px]">
        {scope}
      </Badge>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-row items-center justify-between">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <WrenchIcon className="size-4" />
              {global ? 'Global Skills' : 'Project Skills'}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {global
                ? 'Global skills are available to all projects. Built-in skills are always available.'
                : 'Project-scoped skills override global skills of the same name.'}
            </p>
          </div>
          <Button size="sm" onClick={() => setInstallOpen(true)}>
            <DownloadIcon data-icon="inline-start" />
            Add skill
          </Button>
        </div>
        <div>
          {/* Sorting and filtering controls */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[180px] max-w-[260px]">
              <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Filter skills..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : sortedAndFiltered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {skills.length === 0
                ? 'No skills available. Click Install to add one from a GitHub repository.'
                : 'No skills match the current filters.'}
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto rounded-md border">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="w-[150px] cursor-pointer select-none"
                      onClick={() => toggleSort('name')}
                    >
                      <span className="inline-flex items-center">Name{sortIcon('name')}</span>
                    </TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[80px]">
                      Source
                    </TableHead>
                    <TableHead className="w-[100px]">
                      Scope
                    </TableHead>
                    <TableHead className="w-[130px]">Tags</TableHead>
                    <TableHead className="w-[90px]">Sync</TableHead>
                    <TableHead
                      className="w-[100px] cursor-pointer select-none"
                      onClick={() => toggleSort('lastSyncedAt')}
                    >
                      <span className="inline-flex items-center">Last Synced{sortIcon('lastSyncedAt')}</span>
                    </TableHead>
                    <TableHead className="w-[90px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedAndFiltered.map((skill) => (
                    <TableRow
                      key={skill.name}
                      className="cursor-pointer"
                      onClick={() => view(skill.name)}
                    >
                      <TableCell className="font-medium">{skill.name}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-muted-foreground">
                        {skill.description}
                      </TableCell>
                      <TableCell>
                        <Badge variant={skill.source === 'builtin' ? 'secondary' : 'outline'}>
                          {skill.source}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {scopeBadge(skill.scope)}
                      </TableCell>
                      <TableCell>
                        {editingTags === skill.name ? (
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <Input
                              value={editTagsValue}
                              onChange={(e) => setEditTagsValue(e.target.value)}
                              className="h-7 w-[100px] text-xs"
                              placeholder="plan, review"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveTags();
                                if (e.key === 'Escape') setEditingTags(null);
                              }}
                              autoFocus
                            />
                            <Button variant="ghost" size="icon-sm" onClick={saveTags}>
                              <CheckIcon className="size-3 text-green-500" />
                            </Button>
                            <Button variant="ghost" size="icon-sm" onClick={() => setEditingTags(null)}>
                              <XIcon className="size-3 text-muted-foreground" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 min-w-0">
                            <div className="flex flex-wrap gap-1 min-w-0">
                              {skill.tags?.length ? (
                                skill.tags.map((tag) => (
                                  <Badge key={tag} variant="secondary" className="text-[10px]">
                                    {tag}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">&mdash;</span>
                              )}
                            </div>
                            {skill.source === 'project' && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEditTags(skill);
                                }}
                                className="shrink-0"
                                aria-label={`Edit tags for ${skill.name}`}
                              >
                                <PencilIcon className="size-3" />
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {skill.source === 'project' ? (
                          <div className="flex items-center gap-1">
                            <Switch
                              checked={skill.syncEnabled ?? false}
                              onCheckedChange={() => toggleSync(skill)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                doSync(skill.name);
                              }}
                              disabled={syncing.has(skill.name)}
                              aria-label={`Sync ${skill.name}`}
                              className={syncing.has(skill.name) ? 'animate-spin' : ''}
                            >
                              <RefreshCwIcon className="size-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">&mdash;</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(skill.lastSyncedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              view(skill.name);
                            }}
                            aria-label={`View ${skill.name}`}
                          >
                            <EyeIcon className="size-4" />
                          </Button>
                          {skill.source === 'project' && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmDelete(skill);
                              }}
                              aria-label={`Delete ${skill.name}`}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2Icon className="size-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* View skill detail dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="sm:max-w-[85vw] min-w-[800px] max-h-[92vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldIcon className="size-4" />
              {viewSkill?.name ?? 'Loading...'}
            </DialogTitle>
            <DialogDescription>
              Review the full skill content. Always inspect for suspicious instructions
              before using a skill in production.
            </DialogDescription>
          </DialogHeader>
          {viewLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading...</p>
          ) : viewSkill ? (
            (() => {
              const fm = parseFrontmatter(viewSkill.content);
              const fmEntries = Object.entries(fm.fields);
              return (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={viewSkill.source === 'builtin' ? 'secondary' : 'outline'}>
                      {viewSkill.source}
                    </Badge>
                    {viewSkill.scope && scopeBadge(viewSkill.scope)}
                    {viewSkill.tags?.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                    {(() => {
                      const link = sourceLink(viewSkill.sourceUrl);
                      return link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline ml-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLinkIcon className="size-3" />
                          View source repository
                        </a>
                      ) : null;
                    })()}
                  </div>

                  {fmEntries.length > 0 && (
                    <div className="rounded-md border bg-muted/30">
                      <div className="px-3 py-1.5 border-b bg-muted/50">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Frontmatter
                        </span>
                      </div>
                      <div className="divide-y">
                        {fmEntries.map(([key, value]) => (
                          <div key={key} className="flex items-start px-3 py-2 text-sm gap-3">
                            <span className="font-medium text-muted-foreground capitalize min-w-[120px] shrink-0">
                              {key}
                            </span>
                            <span className="font-mono text-xs break-all">
                              {Array.isArray(value) ? value.join(', ') : value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-md border">
                    <div className="border-b bg-muted/30 px-3 py-1.5">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Body
                      </span>
                    </div>
                    <ScrollArea className="h-[55vh]">
                      <div className="p-4">
                        <Markdown content={fm.body} />
                      </div>
                    </ScrollArea>
                  </div>
                </div>
              );
            })()
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Install skill dialog */}
      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Install a skill</DialogTitle>
            <DialogDescription>
              Browse the recommended catalog or install any skill from a GitHub
              repository. Default scope is {global ? 'global' : 'project'}.
            </DialogDescription>
          </DialogHeader>
          <Tabs
            className="flex-1 flex flex-col min-h-0"
            value={installTab}
            onValueChange={(v) => setInstallTab(v as 'recommended' | 'github')}
          >
            <TabsList className="w-full">
              <TabsTrigger value="recommended">Recommended</TabsTrigger>
              <TabsTrigger value="github">From GitHub</TabsTrigger>
            </TabsList>

            <TabsContent value="recommended" className="mt-4 flex-1 flex flex-col min-h-0">
              {recommendedLoading ? (
                <p className="text-sm text-muted-foreground py-4">Loading recommended skills...</p>
              ) : recommended.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No recommended skills are available.
                </p>
              ) : (
                <div className="flex-1 overflow-y-auto min-h-0">
                  <div className="flex flex-col gap-2 pr-3">
                    {recommended.map((skill) => {
                      const already = installedNames.has(skill.name);
                      return (
                        <div
                          key={skill.name}
                          className="flex items-start justify-between gap-3 rounded-md border bg-card p-3"
                        >
                          <div className="flex flex-col gap-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{skill.name}</span>
                              {skill.author && (
                                <span className="text-[11px] text-muted-foreground">
                                  by {skill.author}
                                </span>
                              )}
                              {skill.tags?.map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-[10px]">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                            <p className="text-xs text-muted-foreground">{skill.description}</p>
                            <a
                              href={sourceLink(skill.source) ?? skill.source}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:underline w-fit"
                            >
                              <ExternalLinkIcon className="size-3" />
                              {skill.skillPath}
                            </a>
                          </div>
                          <Button
                            size="sm"
                            variant={already ? 'outline' : 'default'}
                            disabled={already || installingName === skill.name}
                            onClick={() => installRecommended(skill)}
                            className="shrink-0"
                          >
                            {already ? (
                              <>
                                <CheckIcon data-icon="inline-start" />
                                Installed
                              </>
                            ) : installingName === skill.name ? (
                              'Installing...'
                            ) : (
                              <>
                                <DownloadIcon data-icon="inline-start" />
                                Install
                              </>
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="github" className="mt-4 flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="rounded-lg border-2 border-red-500/50 bg-red-500/5 p-3">
                  <div className="flex items-start gap-3">
                  <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-red-500" />
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">
                      Security Warning: Malicious Skills
                    </h3>
                    <p className="text-xs text-red-700/80 dark:text-red-300/80">
                      Skills can contain arbitrary instructions, commands, and scripts that execute in
                      your environment. Malicious skills may exfiltrate data, modify files without consent,
                      or execute harmful commands. Orion scans every installed skill with{' '}
                      <a
                        href="https://github.com/snyk/agent-scan"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        Snyk agent-scan
                      </a>
                      {' '}to detect known malicious patterns, but{' '}
                      <strong>no automated scan is a substitute for human review</strong>.
                      Always inspect a skill&rsquo;s source repository and content before installing.
                    </p>
                  </div>
                  </div>
                </div>
                <div className="flex flex-col gap-3 mt-3">
                <div className="flex flex-col gap-1.5">
                  <Label>GitHub repository URL</Label>
                  <Input
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Skill path</Label>
                  <Input
                    value={skillPath}
                    onChange={(e) => setSkillPath(e.target.value)}
                    placeholder="skills/my-skill/SKILL.md"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Branch / tag / ref (optional)</Label>
                  <Input
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    placeholder="main"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Tags (optional)</Label>
                  <Input
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="plan, implement"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Comma-separated SDLC tags, e.g. <code>plan, review, implement</code>.
                  </p>
                </div>
                <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <Label className="text-sm">Enable auto-sync</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Periodically check for updates from the source repository.
                    </p>
                  </div>
                  <Switch checked={syncInstall} onCheckedChange={setSyncInstall} />
                </div>
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button variant="outline" size="sm" onClick={() => setInstallOpen(false)} disabled={installing}>
                  Cancel
                </Button>
                <Button size="sm" onClick={install} disabled={!source.trim() || !skillPath.trim() || installing}>
                  {installing ? 'Installing...' : 'Install'}
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangleIcon className="size-5" />
              Delete skill
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <strong>{deleteSkill?.name}</strong>? This will remove the skill&rsquo;s
              files and lock entry.
            </DialogDescription>
          </DialogHeader>
          {deleteRefsLoading ? (
            <p className="text-sm text-muted-foreground">Checking workflow references...</p>
          ) : deleteRefs.length > 0 ? (
            <div className="rounded-md border border-orange-500/50 bg-orange-500/5 p-3">
              <p className="text-sm font-semibold text-orange-600 dark:text-orange-400">
                This skill is referenced by {deleteRefs.length} workflow node(s):
              </p>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                {deleteRefs.map((ref) => (
                  <li key={`${ref.workflowId}-${ref.nodeId}`}>
                    Workflow <strong>{ref.workflowName}</strong>, node{' '}
                    <strong>{ref.nodeId}</strong> ({ref.nodeType})
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-orange-600/80 dark:text-orange-400/80">
                Deleting this skill will cause those agents to fail when they attempt
                to resolve it. Remove the skill references from your config first.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No workflow nodes currently reference this skill.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={doDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
