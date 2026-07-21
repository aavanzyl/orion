import { useState, useEffect, useCallback } from 'react';
import {
  TerminalIcon,
  PlusIcon,
  Trash2Icon,
  ExternalLinkIcon,
  KeyIcon,
  ShieldIcon,
  InfoIcon,
  CheckCircleIcon,
  Loader2Icon,
} from 'lucide-react';
import { toast } from 'sonner';
import YAML from 'yaml';
import { api } from '@/lib/api';
import type { McpServerConfig, McpServer, McpAuthType, McpOAuthInfo } from '@orion/models';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MCP_CATALOG, type McpCatalogEntry } from './mcp-catalog';
import {
  serverOrigin,
  BUILTIN_SERVERS,
  CopyButton,
} from './mcp-shared';

function getCatalogEntry(key: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.key === key);
}

function getServerDisplayInfo(key: string): { name: string; description: string } {
  const entry = getCatalogEntry(key);
  if (entry) return { name: entry.title, description: entry.description };
  return { name: key, description: '' };
}

function authBadge(authType: string) {
  switch (authType) {
    case 'oauth':
      return <Badge variant="secondary" className="text-[10px]">OAuth 2.0</Badge>;
    case 'api_key':
      return <Badge variant="secondary" className="text-[10px]">API Key</Badge>;
    case 'bearer_token':
    case 'bearer':
      return <Badge variant="secondary" className="text-[10px]">Bearer Token</Badge>;
    case 'none':
      return <Badge variant="outline" className="text-[10px] text-muted-foreground">No auth</Badge>;
    default:
      return null;
  }
}

interface McpSectionProps {
  projectId?: string;
  global?: boolean;
}

export function McpSection({ projectId, global = true }: McpSectionProps) {
  const origin = serverOrigin();

  const [mcpServers, setMcpServers] = useState<Record<string, McpServerConfig>>({});
  const [rawConfig, setRawConfig] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [globalServerList, setGlobalServerList] = useState<McpServer[]>([]);

  const serverMeta = useCallback(
    (name: string): McpServer | undefined => globalServerList.find((s) => s.name === name),
    [globalServerList],
  );

  const deriveConfigs = useCallback((servers: McpServer[]): Record<string, McpServerConfig> => {
    return Object.fromEntries(servers.map((s) => [s.name, s.config]));
  }, []);

  const loadGlobal = useCallback(async () => {
    setLoading(true);
    try {
      const servers = await api.listMcpServers();
      setGlobalServerList(servers);
      setMcpServers(deriveConfigs(servers));
      setRawConfig(null);
    } catch {
      toast.error('Failed to load MCP servers');
      setGlobalServerList([]);
      setMcpServers({});
    } finally {
      setLoading(false);
    }
  }, [deriveConfigs]);

  const loadProjectMcp = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const raw = await api.getRawConfig(projectId);
      setRawConfig(raw.content);
      if (raw.content) {
        const doc = YAML.parseDocument(raw.content);
        const servers = doc.get('mcpServers') as Record<string, McpServerConfig> | undefined;
        setMcpServers(servers && typeof servers === 'object' ? servers : {});
      }
    } catch {
      toast.error('Failed to load MCP configuration');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const saveProjectMcp = useCallback(async (servers: Record<string, McpServerConfig>) => {
    if (!projectId) return;
    try {
      const doc = rawConfig ? YAML.parseDocument(rawConfig) : new YAML.Document();
      if (Object.keys(servers).length === 0) {
        doc.delete('mcpServers');
      } else {
        doc.set('mcpServers', servers);
      }
      const updatedYaml = doc.toString();
      await api.saveRawConfig(projectId, updatedYaml);
      setRawConfig(updatedYaml);
    } catch {
      toast.error('Failed to save MCP configuration');
    }
  }, [projectId, rawConfig]);

  useEffect(() => {
    if (global) {
      loadGlobal();
    } else {
      loadProjectMcp();
    }
  }, [global, loadGlobal, loadProjectMcp]);

  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<'catalog' | 'custom'>('catalog');

  const [customName, setCustomName] = useState('');
  const [customMode, setCustomMode] = useState<'stdio' | 'http'>('stdio');
  const [customCommand, setCustomCommand] = useState('');
  const [customArgs, setCustomArgs] = useState('');
  const [customUrl, setCustomUrl] = useState('');

  const [customAuthType, setCustomAuthType] = useState<McpAuthType | 'api_key' | 'bearer_token'>('none');
  const [customBearerToken, setCustomBearerToken] = useState('');

  const [customOauthAuthUrl, setCustomOauthAuthUrl] = useState('');
  const [customOauthTokenUrl, setCustomOauthTokenUrl] = useState('');
  const [customOauthClientId, setCustomOauthClientId] = useState('');
  const [customOauthClientSecret, setCustomOauthClientSecret] = useState('');
  const [customOauthScopes, setCustomOauthScopes] = useState('');

  const [selectedCatalogEntry, setSelectedCatalogEntry] = useState<McpCatalogEntry | null>(null);
  const [credentialValue, setCredentialValue] = useState('');
  const [oauthStep, setOauthStep] = useState<'select' | 'configure' | 'done'>('select');

  const [catalogOauthAuthUrl, setCatalogOauthAuthUrl] = useState('');
  const [catalogOauthTokenUrl, setCatalogOauthTokenUrl] = useState('');
  const [catalogOauthClientId, setCatalogOauthClientId] = useState('');
  const [catalogOauthClientSecret, setCatalogOauthClientSecret] = useState('');
  const [catalogOauthScopes, setCatalogOauthScopes] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState('');
  const [editCommand, setEditCommand] = useState('');
  const [editArgs, setEditArgs] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editBearerToken, setEditBearerToken] = useState('');
  const [editMode, setEditMode] = useState<'stdio' | 'http'>('stdio');
  const [editAuthType, setEditAuthType] = useState<McpAuthType>('none');
  const [editOauthAuthUrl, setEditOauthAuthUrl] = useState('');
  const [editOauthTokenUrl, setEditOauthTokenUrl] = useState('');
  const [editOauthClientId, setEditOauthClientId] = useState('');
  const [editOauthClientSecret, setEditOauthClientSecret] = useState('');
  const [editOauthScopes, setEditOauthScopes] = useState('');

  const entries = Object.entries(mcpServers);

  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const remove = async (key: string) => {
    if (global) {
      const meta = serverMeta(key);
      if (!meta) return;
      try {
        await api.deleteMcpServer(meta.id);
        const updated = globalServerList.filter((s) => s.id !== meta.id);
        setGlobalServerList(updated);
        setMcpServers(deriveConfigs(updated));
        toast.success(`Removed ${key}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to delete server');
      }
    } else {
      const next = { ...mcpServers };
      delete next[key];
      setMcpServers(next);
      saveProjectMcp(next);
    }
  };

  const confirmRemove = async () => {
    if (!deletingKey) return;
    await remove(deletingKey);
  };

  const resetAddDialog = () => {
    setAddOpen(false);
    setAddTab('catalog');
    setCustomName('');
    setCustomCommand('');
    setCustomArgs('');
    setCustomUrl('');
    setCustomAuthType('none');
    setCustomBearerToken('');
    setCustomOauthAuthUrl('');
    setCustomOauthTokenUrl('');
    setCustomOauthClientId('');
    setCustomOauthClientSecret('');
    setCustomOauthScopes('');
    setSelectedCatalogEntry(null);
    setCredentialValue('');
    setOauthStep('select');
    setCatalogOauthAuthUrl('');
    setCatalogOauthTokenUrl('');
    setCatalogOauthClientId('');
    setCatalogOauthClientSecret('');
    setCatalogOauthScopes('');
  };

  const beginCatalogEntry = (entry: McpCatalogEntry) => {
    if (global && entry.key in mcpServers) return;
    if (!global && entry.key in mcpServers) return;
    if (global) {
      if (entry.authType === 'none') {
        addGlobalFromCatalog(entry, {});
        return;
      }
      setSelectedCatalogEntry(entry);
      setCredentialValue('');
      setCatalogOauthAuthUrl('');
      setCatalogOauthTokenUrl('');
      setCatalogOauthClientId('');
      setCatalogOauthClientSecret('');
      setCatalogOauthScopes('');
      setOauthStep('configure');
    } else {
      if (entry.authType === 'none') {
        const next = { ...mcpServers, [entry.key]: entry.config };
        setMcpServers(next);
        saveProjectMcp(next);
        resetAddDialog();
      } else {
        setSelectedCatalogEntry(entry);
        setCredentialValue('');
        setOauthStep('configure');
      }
    }
  };

  const addGlobalFromCatalog = async (entry: McpCatalogEntry, oauthFields: Record<string, string>) => {
    const isOauth = entry.authType === 'oauth';
    try {
      const created = await api.createMcpServer({
        name: entry.key,
        config: entry.config,
        authType: isOauth ? 'oauth' : 'none',
        ...(isOauth && Object.keys(oauthFields).length > 0
          ? {
              oauth: {
                authorizationUrl: oauthFields.authorizationUrl || entry.authUrl || '',
                tokenUrl: oauthFields.tokenUrl || '',
                clientId: oauthFields.clientId || '',
                clientSecret: oauthFields.clientSecret || '',
                scopes: oauthFields.scopes || '',
              },
            }
          : {}),
      });
      const updated = [...globalServerList, created];
      setGlobalServerList(updated);
      setMcpServers(deriveConfigs(updated));
      toast.success(`Added ${entry.key}`);
      resetAddDialog();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add server');
    }
  };

  const finishCatalogEntry = async () => {
    if (!selectedCatalogEntry) return;
    const entry = selectedCatalogEntry;

    if (global) {
      if (entry.authType === 'oauth') {
        await addGlobalFromCatalog(entry, {
          authorizationUrl: catalogOauthAuthUrl,
          tokenUrl: catalogOauthTokenUrl,
          clientId: catalogOauthClientId,
          clientSecret: catalogOauthClientSecret,
          scopes: catalogOauthScopes,
        });
      } else if (entry.authType === 'bearer_token' || entry.authType === 'api_key') {
        let config = { ...entry.config };
        if (credentialValue.trim()) {
          if (config.url) {
            config = { ...config, bearerToken: credentialValue.trim() };
          } else if (config.env) {
            const envKey = Object.keys(config.env)[0];
            if (envKey) {
              config = { ...config, env: { [envKey]: credentialValue.trim() } };
            }
          }
        }
        try {
          const created = await api.createMcpServer({
            name: entry.key,
            config,
            authType: 'bearer',
          });
          const updated = [...globalServerList, created];
          setGlobalServerList(updated);
          setMcpServers(deriveConfigs(updated));
          toast.success(`Added ${entry.key}`);
          resetAddDialog();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Failed to add server');
        }
      } else {
        try {
          const created = await api.createMcpServer({
            name: entry.key,
            config: entry.config,
            authType: 'none',
          });
          const updated = [...globalServerList, created];
          setGlobalServerList(updated);
          setMcpServers(deriveConfigs(updated));
          toast.success(`Added ${entry.key}`);
          resetAddDialog();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Failed to add server');
        }
      }
    } else {
      let config = { ...entry.config };
      if (credentialValue.trim()) {
        if (entry.authType === 'bearer_token' || entry.authType === 'api_key') {
          if (config.url) {
            config = { ...config, bearerToken: credentialValue.trim() };
          } else if (config.env) {
            const envKey = Object.keys(config.env)[0];
            if (envKey) {
              config = { ...config, env: { [envKey]: credentialValue.trim() } };
            }
          }
        }
      }
      const next = { ...mcpServers, [entry.key]: config };
      setMcpServers(next);
      saveProjectMcp(next);
      resetAddDialog();
    }
  };

  const addCustom = async () => {
    const name = customName.trim();
    if (!name) return;
    if (global) {
      const config: McpServerConfig =
        customMode === 'stdio'
          ? { command: customCommand.trim(), args: customArgs.trim() ? customArgs.trim().split(/\s+/) : [] }
          : {
              url: customUrl.trim(),
              ...(customBearerToken.trim() ? { bearerToken: customBearerToken.trim() } : {}),
            };
      const resolveAuthType = (): McpAuthType => {
        if (customAuthType === 'oauth') return 'oauth';
        if (customAuthType === 'bearer' || customAuthType === 'bearer_token') return 'bearer';
        return 'none';
      };
      try {
        const created = await api.createMcpServer({
          name,
          config,
          authType: resolveAuthType(),
          ...(customAuthType === 'oauth'
            ? {
                oauth: {
                  authorizationUrl: customOauthAuthUrl.trim(),
                  tokenUrl: customOauthTokenUrl.trim(),
                  clientId: customOauthClientId.trim(),
                  clientSecret: customOauthClientSecret.trim(),
                  scopes: customOauthScopes.trim(),
                },
              }
            : {}),
        });
        const updated = [...globalServerList, created];
        setGlobalServerList(updated);
        setMcpServers(deriveConfigs(updated));
        toast.success(`Added ${name}`);
        resetAddDialog();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create server');
      }
    } else {
      const config: McpServerConfig =
        customMode === 'stdio'
          ? { command: customCommand.trim(), args: customArgs.trim() ? customArgs.trim().split(/\s+/) : [] }
          : { url: customUrl.trim(), ...(customBearerToken.trim() ? { bearerToken: customBearerToken.trim() } : {}) };
      const next = { ...mcpServers, [name]: config };
      setMcpServers(next);
      saveProjectMcp(next);
      resetAddDialog();
    }
  };

  const openAddDialog = () => {
    setAddTab('catalog');
    setSelectedCatalogEntry(null);
    setCredentialValue('');
    setOauthStep('select');
    setCustomAuthType('none');
    setCustomBearerToken('');
    setCustomOauthAuthUrl('');
    setCustomOauthTokenUrl('');
    setCustomOauthClientId('');
    setCustomOauthClientSecret('');
    setCustomOauthScopes('');
    setAddOpen(true);
  };

  const openEditDialog = (key: string, config: McpServerConfig) => {
    setEditKey(key);
    if (isStdio(config)) {
      setEditMode('stdio');
      setEditCommand(config.command ?? '');
      setEditArgs((config.args ?? []).join(' '));
      setEditUrl('');
      setEditBearerToken('');
    } else {
      setEditMode('http');
      setEditUrl(config.url ?? '');
      setEditBearerToken(config.bearerToken ?? '');
      setEditCommand('');
      setEditArgs('');
    }
    if (global) {
      const meta = serverMeta(key);
      if (meta) {
        setEditAuthType(meta.authType);
        setEditOauthAuthUrl(meta.oauth.authorizationUrl ?? '');
        setEditOauthTokenUrl(meta.oauth.tokenUrl ?? '');
        setEditOauthClientId(meta.oauth.clientId ?? '');
        setEditOauthClientSecret('');
        setEditOauthScopes(meta.oauth.scopes ?? '');
      } else {
        setEditAuthType('none');
        setEditOauthAuthUrl('');
        setEditOauthTokenUrl('');
        setEditOauthClientId('');
        setEditOauthClientSecret('');
        setEditOauthScopes('');
      }
    }
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editKey) return;
    if (global) {
      const meta = serverMeta(editKey);
      if (!meta) return;
      const config: McpServerConfig =
        editMode === 'stdio'
          ? { command: editCommand.trim(), args: editArgs.trim() ? editArgs.trim().split(/\s+/) : [] }
          : { url: editUrl.trim(), ...(editBearerToken.trim() ? { bearerToken: editBearerToken.trim() } : {}) };
      const patchAuthType = editAuthType;
      const oauthPatch =
        patchAuthType === 'oauth'
          ? {
              authorizationUrl: editOauthAuthUrl.trim(),
              tokenUrl: editOauthTokenUrl.trim(),
              clientId: editOauthClientId.trim(),
              ...(editOauthClientSecret.trim() ? { clientSecret: editOauthClientSecret.trim() } : {}),
              scopes: editOauthScopes.trim(),
            }
          : null;
      try {
        const updated = await api.updateMcpServer(meta.id, {
          config,
          authType: patchAuthType,
          ...(oauthPatch !== null ? { oauth: oauthPatch } : {}),
        });
        const list = globalServerList.map((s) => (s.id === updated.id ? updated : s));
        setGlobalServerList(list);
        setMcpServers(deriveConfigs(list));
        toast.success(`Updated ${editKey}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to update server');
      }
    } else {
      const config: McpServerConfig =
        editMode === 'stdio'
          ? { command: editCommand.trim(), args: editArgs.trim() ? editArgs.trim().split(/\s+/) : [] }
          : { url: editUrl.trim(), ...(editBearerToken.trim() ? { bearerToken: editBearerToken.trim() } : {}) };
      const next = { ...mcpServers, [editKey]: config };
      setMcpServers(next);
      saveProjectMcp(next);
    }
    setEditOpen(false);
    setEditKey('');
  };

  const isStdio = (c: McpServerConfig) => typeof c.command === 'string' && c.command.length > 0;
  const isHttp = (c: McpServerConfig) => typeof c.url === 'string' && c.url.length > 0;

  const badgeList = (items: string[] | undefined) => {
    if (!items || items.length === 0) return <span className="text-xs text-muted-foreground/50">&mdash;</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Badge key={item} variant="outline" className="font-mono text-[10px]">
            {item}
          </Badge>
        ))}
      </div>
    );
  };

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">
            {global ? 'Global MCP servers' : 'Project MCP servers'}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {global
              ? 'Shared by every agent node across all projects.'
              : 'Shared by every agent node in the project.'}
          </p>
        </div>
        <Button size="sm" onClick={openAddDialog} disabled={loading}>
          <PlusIcon data-icon="inline-start" />
          Add MCP
        </Button>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Name</TableHead>
              <TableHead className="w-[140px]">Key</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[90px]">Type</TableHead>
              <TableHead className="w-[100px]">Auth</TableHead>
              <TableHead className="w-[240px]">Tools</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {BUILTIN_SERVERS.map((s) => {
              const url = `${origin}${s.path}`;
              return (
                <TableRow key={s.key}>
                  <TableCell className="font-medium align-top">
                    <div className="flex items-center gap-1.5">
                      <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      {s.title}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {s.key}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm align-top">
                    {s.description}
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant="secondary" className="font-mono text-[10px]">built-in</Badge>
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">No auth</Badge>
                  </TableCell>
                  <TableCell className="align-top">{badgeList([...s.tools, ...s.resources, ...s.prompts])}</TableCell>
                  <TableCell className="align-top">
                    <CopyButton value={url} />
                  </TableCell>
                </TableRow>
              );
            })}

            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                  {global
                    ? 'No global MCP servers configured.'
                    : 'No project-wide MCP servers configured.'}
                </TableCell>
              </TableRow>
            )}

            {entries.map(([key, config]) => {
              const info = getServerDisplayInfo(key);
              const catalogEntry = getCatalogEntry(key);
              const meta = global ? serverMeta(key) : undefined;
              const displayAuthType = (() => {
                if (meta) {
                  if (meta.authType === 'oauth') return 'oauth';
                  if (meta.authType === 'bearer') return 'bearer';
                  return 'none';
                }
                const authInfo = catalogEntry?.authType;
                if (!authInfo) return 'none';
                return authInfo;
              })();
              const oauthInfo = meta?.oauth as McpOAuthInfo | undefined;
              const setupNote = catalogEntry?.setupNote;
              return (
                <TableRow key={key} className="cursor-pointer hover:bg-muted/50" onClick={() => openEditDialog(key, config)}>
                  <TableCell className="font-medium align-top">
                    <div className="flex items-center gap-1.5">
                      <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span>{info.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {key}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm align-top">
                    {info.description || <span className="text-muted-foreground/50">&mdash;</span>}
                    {setupNote && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        {setupNote}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    {isStdio(config) && <Badge variant="secondary" className="font-mono text-[10px]">stdio</Badge>}
                    {isHttp(config) && <Badge variant="secondary" className="font-mono text-[10px]">http</Badge>}
                  </TableCell>
                  <TableCell className="align-top">
                    {authBadge(displayAuthType)}
                  </TableCell>
                  <TableCell className="align-top">{badgeList([...(catalogEntry?.tools ?? []), ...(catalogEntry?.resources ?? []), ...(catalogEntry?.prompts ?? [])])}</TableCell>
                  <TableCell className="align-top">
                    <div className="flex items-center gap-1">
                      {global && meta && meta.authType === 'oauth' && (
                        <Button
                          variant={oauthInfo?.hasAccessToken ? 'outline' : 'default'}
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (oauthInfo?.hasAccessToken) return;
                            api
                              .startMcpOauth(meta.id)
                              .then((res) => {
                                const popup = window.open(
                                  res.authorizationUrl,
                                  'oauth',
                                  'width=600,height=700',
                                );
                                const timer = setInterval(() => {
                                  if (!popup || popup.closed) {
                                    clearInterval(timer);
                                    loadGlobal();
                                  }
                                }, 500);
                              })
                              .catch((err) => {
                                toast.error(err instanceof Error ? err.message : 'OAuth start failed');
                              });
                          }}
                        >
                          {oauthInfo?.hasAccessToken ? (
                            <>
                              <CheckCircleIcon className="size-3 text-emerald-500 mr-1" />
                              Connected
                            </>
                          ) : (
                            <>
                              <ShieldIcon className="size-3 mr-1" />
                              Authorize
                            </>
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => { e.stopPropagation(); setDeletingKey(key); }}
                        aria-label={`Remove ${key}`}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Add MCP Dialog */}
      <Dialog open={addOpen} onOpenChange={(open) => { if (!open) resetAddDialog(); else setAddOpen(true); }}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add MCP Server</DialogTitle>
            <DialogDescription>
              {oauthStep === 'select'
                ? 'Choose a pre-configured server from the catalog or build a custom one.'
                : 'Set up authentication to connect this server.'}
            </DialogDescription>
          </DialogHeader>

          {oauthStep === 'select' ? (
            <Tabs value={addTab} onValueChange={(v) => setAddTab(v as 'catalog' | 'custom')} className="flex-1 flex flex-col min-h-0">
              <TabsList className="w-full">
                <TabsTrigger value="catalog" className="flex-1">Catalog</TabsTrigger>
                <TabsTrigger value="custom" className="flex-1">Custom</TabsTrigger>
              </TabsList>

              <TabsContent value="catalog" className="flex-1 overflow-y-auto mt-3 flex flex-col gap-2">
                {MCP_CATALOG.map((entry) => {
                  const alreadyAdded = entry.key in mcpServers;
                  const needsAuth = entry.authType !== 'none';
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => beginCatalogEntry(entry)}
                      className={`text-left rounded-md border p-3 hover:border-primary/50 transition-colors ${
                        alreadyAdded ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{entry.title}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
                          {entry.key}
                        </span>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {entry.category}
                        </Badge>
                        {authBadge(entry.authType)}
                        {alreadyAdded && (
                          <span className="text-[10px] text-muted-foreground ml-auto">Added</span>
                        )}
                        {needsAuth && !alreadyAdded && (
                          <KeyIcon className="size-3 text-amber-500 ml-auto" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{entry.description}</p>
                      {entry.setupNote && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                          <InfoIcon className="size-3 inline mr-1" />
                          {entry.setupNote}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {entry.tools.slice(0, 6).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-muted/50 px-1 py-0.5 text-[10px] text-muted-foreground font-mono"
                          >
                            {t}
                          </span>
                        ))}
                        {entry.tools.length > 6 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{entry.tools.length - 6} more
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </TabsContent>

              <TabsContent value="custom" className="flex flex-col gap-3 mt-3 flex-1 min-h-0 overflow-y-auto">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">Server name</Label>
                  <Input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="my-server"
                    className="h-8"
                  />
                </div>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    className={`rounded px-2 py-1 ${customMode === 'stdio' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
                    onClick={() => setCustomMode('stdio')}
                  >
                    Stdio
                  </button>
                  <button
                    type="button"
                    className={`rounded px-2 py-1 ${customMode === 'http' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
                    onClick={() => setCustomMode('http')}
                  >
                    HTTP
                  </button>
                </div>
                {customMode === 'stdio' ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">Command</Label>
                      <Input
                        value={customCommand}
                        onChange={(e) => setCustomCommand(e.target.value)}
                        placeholder="npx"
                        className="h-8"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">Arguments</Label>
                      <Input
                        value={customArgs}
                        onChange={(e) => setCustomArgs(e.target.value)}
                        placeholder="-y package-name"
                        className="h-8"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">URL</Label>
                      <Input
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                        placeholder="https://..."
                        className="h-8"
                      />
                    </div>
                    {global && (
                      <>
                        <div className="flex flex-col gap-1.5">
                          <Label className="text-xs text-muted-foreground">Authentication</Label>
                          <div className="flex gap-2 text-xs">
                            {(['none', 'bearer', 'oauth'] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                className={`rounded px-2 py-1 capitalize ${customAuthType === t ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
                                onClick={() => setCustomAuthType(t)}
                              >
                                {t === 'none' ? 'None' : t === 'bearer' ? 'Bearer Token' : 'OAuth 2.0'}
                              </button>
                            ))}
                          </div>
                        </div>
                        {customAuthType === 'bearer' && (
                          <div className="flex flex-col gap-1.5">
                            <Label className="text-xs text-muted-foreground">Bearer token</Label>
                            <Input
                              value={customBearerToken}
                              onChange={(e) => setCustomBearerToken(e.target.value)}
                              placeholder="${TOKEN}"
                              className="h-8"
                            />
                          </div>
                        )}
                        {customAuthType === 'oauth' && (
                          <div className="flex flex-col gap-2 rounded-md border p-3 bg-muted/30">
                            <p className="text-xs text-muted-foreground font-medium">OAuth Configuration</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="flex flex-col gap-1">
                                <Label className="text-[11px] text-muted-foreground">Authorization URL</Label>
                                <Input value={customOauthAuthUrl} onChange={(e) => setCustomOauthAuthUrl(e.target.value)} placeholder="https://..." className="h-8 text-xs" />
                              </div>
                              <div className="flex flex-col gap-1">
                                <Label className="text-[11px] text-muted-foreground">Token URL</Label>
                                <Input value={customOauthTokenUrl} onChange={(e) => setCustomOauthTokenUrl(e.target.value)} placeholder="https://..." className="h-8 text-xs" />
                              </div>
                              <div className="flex flex-col gap-1">
                                <Label className="text-[11px] text-muted-foreground">Client ID</Label>
                                <Input value={customOauthClientId} onChange={(e) => setCustomOauthClientId(e.target.value)} placeholder="..." className="h-8 text-xs" />
                              </div>
                              <div className="flex flex-col gap-1">
                                <Label className="text-[11px] text-muted-foreground">Client Secret</Label>
                                <Input value={customOauthClientSecret} onChange={(e) => setCustomOauthClientSecret(e.target.value)} placeholder="..." className="h-8 text-xs" type="password" />
                              </div>
                              <div className="flex flex-col gap-1 col-span-2">
                                <Label className="text-[11px] text-muted-foreground">Scopes (space-separated)</Label>
                                <Input value={customOauthScopes} onChange={(e) => setCustomOauthScopes(e.target.value)} placeholder="read write" className="h-8 text-xs" />
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {!global && (
                      <>
                        <div className="flex flex-col gap-1.5">
                          <Label className="text-xs text-muted-foreground">Bearer token (optional)</Label>
                          <Input
                            value={customBearerToken}
                            onChange={(e) => setCustomBearerToken(e.target.value)}
                            placeholder="${TOKEN}"
                            className="h-8"
                          />
                        </div>
                        <div className="rounded-md border bg-muted/50 p-4 mt-2">
                          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                            <ShieldIcon className="size-3.5 shrink-0 mt-0.5" />
                            For OAuth-secured HTTP MCP servers, enter the server URL and your bearer token above.
                            The token is sent as an{' '}
                            <code className="rounded bg-muted px-1 py-0.5 text-[11px] font-mono">Authorization: Bearer</code>
                            {' '}header on every request.
                          </p>
                        </div>
                      </>
                    )}
                  </>
                )}
                <DialogFooter className="mt-auto shrink-0">
                  <Button variant="outline" size="sm" onClick={resetAddDialog}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={addCustom}
                    disabled={
                      !customName.trim() ||
                      (customMode === 'stdio'
                        ? !customCommand.trim()
                        : !customUrl.trim()) ||
                      (global && customAuthType === 'oauth' && (!customOauthAuthUrl.trim() || !customOauthTokenUrl.trim() || !customOauthClientId.trim()))
                    }
                  >
                    Add Server
                  </Button>
                </DialogFooter>
              </TabsContent>
            </Tabs>
          ) : oauthStep === 'configure' && selectedCatalogEntry ? (
            <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
              <div className="rounded-md border p-4 bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-sm">{selectedCatalogEntry.title}</span>
                  {authBadge(selectedCatalogEntry.authType)}
                </div>
                <p className="text-xs text-muted-foreground">{selectedCatalogEntry.description}</p>
              </div>

              {global && selectedCatalogEntry.authType === 'oauth' ? (
                <div className="flex flex-col gap-2 rounded-md border p-3 bg-muted/30">
                  <p className="text-xs text-muted-foreground font-medium">OAuth Configuration</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px] text-muted-foreground">Authorization URL</Label>
                      <Input
                        value={catalogOauthAuthUrl}
                        onChange={(e) => setCatalogOauthAuthUrl(e.target.value)}
                        placeholder="https://..."
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px] text-muted-foreground">Token URL</Label>
                      <Input
                        value={catalogOauthTokenUrl}
                        onChange={(e) => setCatalogOauthTokenUrl(e.target.value)}
                        placeholder="https://..."
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px] text-muted-foreground">Client ID</Label>
                      <Input
                        value={catalogOauthClientId}
                        onChange={(e) => setCatalogOauthClientId(e.target.value)}
                        placeholder="..."
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-[11px] text-muted-foreground">Client Secret</Label>
                      <Input
                        value={catalogOauthClientSecret}
                        onChange={(e) => setCatalogOauthClientSecret(e.target.value)}
                        placeholder="..."
                        className="h-8 text-xs"
                        type="password"
                      />
                    </div>
                    <div className="flex flex-col gap-1 col-span-2">
                      <Label className="text-[11px] text-muted-foreground">Scopes (space-separated)</Label>
                      <Input
                        value={catalogOauthScopes}
                        onChange={(e) => setCatalogOauthScopes(e.target.value)}
                        placeholder="read write"
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    The auth URL is pre-filled from the catalog. Fill in Token URL, Client ID, Client Secret,
                    and Scopes for this OAuth provider. You will authorize via popup after adding the server.
                  </p>
                  {selectedCatalogEntry.authUrl && (
                    <a
                      href={selectedCatalogEntry.authUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline w-fit"
                    >
                      <ExternalLinkIcon className="size-3.5" />
                      Open provider setup page
                    </a>
                  )}
                </div>
              ) : (
                <>
                  {selectedCatalogEntry.oauthGuide && (
                    <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
                      <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-2 flex items-center gap-1.5">
                        <ShieldIcon className="size-3.5" />
                        Authentication Required
                      </p>
                      <pre className="text-xs text-blue-700/80 dark:text-blue-300/80 whitespace-pre-wrap leading-relaxed">
                        {selectedCatalogEntry.oauthGuide}
                      </pre>
                    </div>
                  )}

                  {selectedCatalogEntry.authUrl && (
                    <a
                      href={selectedCatalogEntry.authUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline w-fit"
                    >
                      <ExternalLinkIcon className="size-3.5" />
                      Open credential setup page
                    </a>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {selectedCatalogEntry.authType === 'bearer_token'
                        ? 'Bearer Token'
                        : selectedCatalogEntry.authType === 'api_key'
                          ? 'API Key'
                          : 'Credential'}
                    </Label>
                    <Input
                      value={credentialValue}
                      onChange={(e) => setCredentialValue(e.target.value)}
                      placeholder={
                        selectedCatalogEntry.authType === 'bearer_token'
                          ? 'ghp_...'
                          : selectedCatalogEntry.authType === 'api_key'
                            ? 'sk_...'
                            : 'Paste your credential here'
                      }
                      className="h-8"
                      type="password"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Your credential is stored in-memory only and is never sent to Orion&apos;s servers.
                      To verify this server works, run a quick test after adding it.
                    </p>
                  </div>
                </>
              )}

              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                  <InfoIcon className="size-3.5 shrink-0 mt-0.5" />
                  After adding this server, agents will call its tools automatically during runs.
                  {global && selectedCatalogEntry.authType === 'oauth' && (
                    ' Use the Authorize button on the server after adding it to complete the OAuth flow.'
                  )}
                </p>
              </div>

              <DialogFooter className="shrink-0">
                <Button variant="outline" size="sm" onClick={() => setOauthStep('select')}>
                  Back
                </Button>
                <Button
                  size="sm"
                  onClick={finishCatalogEntry}
                  disabled={
                    global &&
                    selectedCatalogEntry.authType === 'oauth' &&
                    (!catalogOauthAuthUrl.trim() || !catalogOauthTokenUrl.trim() || !catalogOauthClientId.trim())
                  }
                >
                  {global && selectedCatalogEntry.authType === 'oauth'
                    ? 'Add Server (then authorize)'
                    : 'Connect &amp; Add Server'}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Edit MCP Dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { if (!open) { setEditOpen(false); setEditKey(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit MCP Server: {editKey}</DialogTitle>
            <DialogDescription>
              Update the configuration for this MCP server.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              className={`rounded px-2 py-1 ${editMode === 'stdio' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
              onClick={() => setEditMode('stdio')}
            >
              Stdio
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 ${editMode === 'http' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
              onClick={() => setEditMode('http')}
            >
              HTTP
            </button>
          </div>
          {editMode === 'stdio' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Command</Label>
                <Input
                  value={editCommand}
                  onChange={(e) => setEditCommand(e.target.value)}
                  placeholder="npx"
                  className="h-8"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Arguments</Label>
                <Input
                  value={editArgs}
                  onChange={(e) => setEditArgs(e.target.value)}
                  placeholder="-y package-name"
                  className="h-8"
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">URL</Label>
                <Input
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  placeholder="https://..."
                  className="h-8"
                />
              </div>
              {global && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">Authentication</Label>
                    <div className="flex gap-2 text-xs">
                      {(['none', 'bearer', 'oauth'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`rounded px-2 py-1 capitalize ${editAuthType === t ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
                          onClick={() => setEditAuthType(t)}
                        >
                          {t === 'none' ? 'None' : t === 'bearer' ? 'Bearer Token' : 'OAuth 2.0'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {editAuthType === 'bearer' && (
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">Bearer token</Label>
                      <Input
                        value={editBearerToken}
                        onChange={(e) => setEditBearerToken(e.target.value)}
                        placeholder="${TOKEN}"
                        className="h-8"
                      />
                    </div>
                  )}
                  {editAuthType === 'oauth' && (
                    <div className="flex flex-col gap-2 rounded-md border p-3 bg-muted/30">
                      <p className="text-xs text-muted-foreground font-medium">OAuth Configuration</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <Label className="text-[11px] text-muted-foreground">Authorization URL</Label>
                          <Input value={editOauthAuthUrl} onChange={(e) => setEditOauthAuthUrl(e.target.value)} placeholder="https://..." className="h-8 text-xs" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-[11px] text-muted-foreground">Token URL</Label>
                          <Input value={editOauthTokenUrl} onChange={(e) => setEditOauthTokenUrl(e.target.value)} placeholder="https://..." className="h-8 text-xs" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-[11px] text-muted-foreground">Client ID</Label>
                          <Input value={editOauthClientId} onChange={(e) => setEditOauthClientId(e.target.value)} placeholder="..." className="h-8 text-xs" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-[11px] text-muted-foreground">Client Secret</Label>
                          <Input value={editOauthClientSecret} onChange={(e) => setEditOauthClientSecret(e.target.value)} placeholder="..." className="h-8 text-xs" type="password" />
                        </div>
                        <div className="flex flex-col gap-1 col-span-2">
                          <Label className="text-[11px] text-muted-foreground">Scopes (space-separated)</Label>
                          <Input value={editOauthScopes} onChange={(e) => setEditOauthScopes(e.target.value)} placeholder="read write" className="h-8 text-xs" />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
              {!global && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">Bearer token (optional)</Label>
                  <Input
                    value={editBearerToken}
                    onChange={(e) => setEditBearerToken(e.target.value)}
                    placeholder="${TOKEN}"
                    className="h-8"
                  />
                </div>
              )}
            </>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setEditOpen(false); setEditKey(''); }}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveEdit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deletingKey !== null}
        onOpenChange={(open) => { if (!open) setDeletingKey(null); }}
        title="Remove MCP server"
        description={`Are you sure you want to remove "${deletingKey}"?`}
        confirmLabel="Remove"
        onConfirm={confirmRemove}
      />
    </div>
  );
}
