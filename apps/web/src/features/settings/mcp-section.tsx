import { useState, useEffect, useCallback } from 'react';
import {
  CheckIcon,
  CopyIcon,
  TerminalIcon,
  PlusIcon,
  Trash2Icon,
  ExternalLinkIcon,
  KeyIcon,
  ShieldIcon,
  InfoIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import YAML from 'yaml';
import { copyToClipboard } from '@/lib/utils';
import { api } from '@/lib/api';
import type { McpServerConfig } from '@orion/models';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api';

const GLOBAL_MCP_STORAGE_KEY = 'orion_global_mcp_servers';

function serverOrigin(): string {
  try {
    return new URL(API_URL).origin;
  } catch {
    return API_URL.replace(/\/api\/?$/, '');
  }
}

interface BuiltinServer {
  key: string;
  title: string;
  description: string;
  path: string;
  tools: string[];
  resources: string[];
  prompts: string[];
}

const BUILTIN_SERVERS: BuiltinServer[] = [
  {
    key: 'orion-codebase',
    title: 'Codebase',
    description: 'Semantic search over an indexed project codebase (RAG).',
    path: '/mcp/codebase',
    tools: ['list_projects', 'search_code', 'index_status'],
    resources: [],
    prompts: [],
  },
  {
    key: 'orion-tickets',
    title: 'Tickets',
    description: 'Read and manage the Orion board: tickets, swimlanes and labels.',
    path: '/mcp/tickets',
    tools: [
      'list_projects',
      'list_tickets',
      'get_ticket',
      'create_ticket',
      'update_ticket',
      'move_ticket',
      'list_labels',
    ],
    resources: [],
    prompts: [],
  },
];

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyToClipboard(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy">
      {copied ? <CheckIcon className="text-emerald-500" /> : <CopyIcon />}
    </Button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative rounded-md border bg-muted/50">
      <div className="absolute right-1.5 top-1.5">
        <CopyButton value={code} />
      </div>
      <pre className="overflow-auto p-3 pr-10 text-xs leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

function getCatalogEntry(key: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.key === key);
}

function getServerDisplayInfo(key: string): { name: string; description: string } {
  const entry = getCatalogEntry(key);
  if (entry) return { name: entry.title, description: entry.description };
  return { name: key, description: '' };
}

function getServerAuthInfo(key: string): {
  authType: string;
  authUrl?: string;
  oauthGuide?: string;
  setupNote?: string;
} {
  const entry = getCatalogEntry(key);
  if (!entry) return { authType: 'unknown' };
  return {
    authType: entry.authType,
    authUrl: entry.authUrl,
    oauthGuide: entry.oauthGuide,
    setupNote: entry.setupNote,
  };
}

function authBadge(authType: string) {
  switch (authType) {
    case 'oauth':
      return <Badge variant="secondary" className="text-[10px]">OAuth 2.0</Badge>;
    case 'api_key':
      return <Badge variant="secondary" className="text-[10px]">API Key</Badge>;
    case 'bearer_token':
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

  const loadProjectMcp = useCallback(async () => {
    if (!projectId) return;
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
    }
  }, [projectId]);

  const saveGlobalMcp = useCallback((servers: Record<string, McpServerConfig>) => {
    try {
      localStorage.setItem(GLOBAL_MCP_STORAGE_KEY, JSON.stringify(servers));
    } catch {
      toast.error('Failed to save global MCP configuration');
    }
  }, []);

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

  const persistMcp = useCallback((servers: Record<string, McpServerConfig>) => {
    if (global) {
      saveGlobalMcp(servers);
    } else {
      saveProjectMcp(servers);
    }
  }, [global, saveGlobalMcp, saveProjectMcp]);

  useEffect(() => {
    if (global) {
      try {
        const stored = localStorage.getItem(GLOBAL_MCP_STORAGE_KEY);
        setMcpServers(stored ? JSON.parse(stored) : {});
      } catch {
        setMcpServers({});
      }
      setRawConfig(null);
    } else {
      loadProjectMcp();
    }
  }, [global, loadProjectMcp]);

  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<'catalog' | 'custom'>('catalog');

  const [customName, setCustomName] = useState('');
  const [customMode, setCustomMode] = useState<'stdio' | 'http'>('stdio');
  const [customCommand, setCustomCommand] = useState('');
  const [customArgs, setCustomArgs] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customToken, setCustomToken] = useState('');

  const [selectedCatalogEntry, setSelectedCatalogEntry] = useState<McpCatalogEntry | null>(null);
  const [credentialValue, setCredentialValue] = useState('');
  const [oauthStep, setOauthStep] = useState<'select' | 'configure' | 'done'>('select');

  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState('');
  const [editCommand, setEditCommand] = useState('');
  const [editArgs, setEditArgs] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editBearerToken, setEditBearerToken] = useState('');
  const [editMode, setEditMode] = useState<'stdio' | 'http'>('stdio');

  const entries = Object.entries(mcpServers);

  const remove = (key: string) => {
    const next = { ...mcpServers };
    delete next[key];
    setMcpServers(next);
    persistMcp(next);
  };

  const addCustom = () => {
    const name = customName.trim();
    if (!name) return;
    const config: McpServerConfig =
      customMode === 'stdio'
        ? { command: customCommand.trim(), args: customArgs.trim() ? customArgs.trim().split(/\s+/) : [] }
        : { url: customUrl.trim(), ...(customToken.trim() ? { bearerToken: customToken.trim() } : {}) };
    const next = { ...mcpServers, [name]: config };
    setMcpServers(next);
    persistMcp(next);
    resetAddDialog();
  };

  const resetAddDialog = () => {
    setAddOpen(false);
    setAddTab('catalog');
    setCustomName('');
    setCustomCommand('');
    setCustomArgs('');
    setCustomUrl('');
    setCustomToken('');
    setSelectedCatalogEntry(null);
    setCredentialValue('');
    setOauthStep('select');
  };

  const beginCatalogEntry = (entry: McpCatalogEntry) => {
    if (entry.key in mcpServers) return;
    if (entry.authType === 'none') {
      const next = { ...mcpServers, [entry.key]: entry.config };
      setMcpServers(next);
      persistMcp(next);
      resetAddDialog();
    } else {
      setSelectedCatalogEntry(entry);
      setCredentialValue('');
      setOauthStep('configure');
    }
  };

  const finishCatalogEntry = () => {
    if (!selectedCatalogEntry) return;
    const entry = selectedCatalogEntry;

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
    persistMcp(next);
    resetAddDialog();
  };

  const openAddDialog = () => {
    setAddTab('catalog');
    setSelectedCatalogEntry(null);
    setCredentialValue('');
    setOauthStep('select');
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
    setEditOpen(true);
  };

  const saveEdit = () => {
    if (!editKey) return;
    const config: McpServerConfig =
      editMode === 'stdio'
        ? { command: editCommand.trim(), args: editArgs.trim() ? editArgs.trim().split(/\s+/) : [] }
        : { url: editUrl.trim(), ...(editBearerToken.trim() ? { bearerToken: editBearerToken.trim() } : {}) };
    const next = { ...mcpServers, [editKey]: config };
    setMcpServers(next);
    persistMcp(next);
    setEditOpen(false);
    setEditKey('');
  };

  const isStdio = (c: McpServerConfig) => typeof c.command === 'string' && c.command.length > 0;
  const isHttp = (c: McpServerConfig) => typeof c.url === 'string' && c.url.length > 0;

  const clientConfig = JSON.stringify(
    {
      mcpServers: Object.fromEntries(
        BUILTIN_SERVERS.map((s) => [
          s.key,
          { url: `${origin}${s.path}?projectId=<PROJECT_ID>` },
        ]),
      ),
    },
    null,
    2,
  );

  const agentYaml = `# .orion/config.yaml
workflow:
  nodes:
    - id: implement
      type: agent
      provider: codex
      # MCP servers unique to this node (merged with project-wide servers)
      mcpServers:
        context7:
          command: npx
          args: ['-y', '@upstash/context7-mcp']
        github:
          url: https://api.githubcopilot.com/mcp/
          bearerToken: \${GITHUB_TOKEN}

# Shared by every agent node in the project
mcpServers:
  linear:
    command: npx
    args: ['-y', 'mcp-remote', 'https://mcp.linear.app/sse']`;

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
        <Button size="sm" onClick={openAddDialog}>
          <PlusIcon data-icon="inline-start" />
          Add MCP
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[90px]">Type</TableHead>
              <TableHead className="w-[100px]">Auth</TableHead>
              <TableHead className="w-[200px]">Tools</TableHead>
              <TableHead className="w-[200px]">Resources</TableHead>
              <TableHead className="w-[200px]">Prompts</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {BUILTIN_SERVERS.map((s) => {
              const url = `${origin}${s.path}?projectId=<PROJECT_ID>`;
              return (
                <TableRow key={s.key}>
                  <TableCell className="font-medium align-top">
                    <div className="flex items-center gap-1.5">
                      <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      {s.title}
                    </div>
                    <Badge variant="secondary" className="font-mono mt-1 text-[10px]">
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
                  <TableCell className="align-top">{badgeList(s.tools)}</TableCell>
                  <TableCell className="align-top">{badgeList(s.resources)}</TableCell>
                  <TableCell className="align-top">{badgeList(s.prompts)}</TableCell>
                  <TableCell className="align-top">
                    <CopyButton value={url} />
                  </TableCell>
                </TableRow>
              );
            })}

            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
                  {global
                    ? 'No global MCP servers configured.'
                    : 'No project-wide MCP servers configured.'}
                </TableCell>
              </TableRow>
            )}

            {entries.map(([key, config]) => {
              const info = getServerDisplayInfo(key);
              const authInfo = getServerAuthInfo(key);
              const catalogEntry = getCatalogEntry(key);
              return (
                <TableRow key={key} className="cursor-pointer hover:bg-muted/50" onClick={() => openEditDialog(key, config)}>
                  <TableCell className="font-medium align-top">
                    <div className="flex items-center gap-1.5">
                      <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span>{info.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm align-top">
                    {info.description || <span className="text-muted-foreground/50">&mdash;</span>}
                    {authInfo.setupNote && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        {authInfo.setupNote}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    {isStdio(config) && <Badge variant="secondary" className="font-mono text-[10px]">stdio</Badge>}
                    {isHttp(config) && <Badge variant="secondary" className="font-mono text-[10px]">http</Badge>}
                  </TableCell>
                  <TableCell className="align-top">
                    {authInfo.authType !== 'unknown' ? authBadge(authInfo.authType) : <Badge variant="outline" className="text-[10px] text-muted-foreground">No auth</Badge>}
                  </TableCell>
                  <TableCell className="align-top">{badgeList(catalogEntry?.tools)}</TableCell>
                  <TableCell className="align-top">{badgeList(catalogEntry?.resources)}</TableCell>
                  <TableCell className="align-top">{badgeList(catalogEntry?.prompts)}</TableCell>
                  <TableCell className="align-top">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => { e.stopPropagation(); remove(key); }}
                      aria-label={`Remove ${key}`}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connect an external MCP client</CardTitle>
          <CardDescription>
            Point any MCP-capable client (Claude Desktop, Cursor, another agent) at the built-in
            servers. Replace <code>&lt;PROJECT_ID&gt;</code> with a real project id.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock code={clientConfig} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Give an agent its own MCP servers</CardTitle>
          <CardDescription>
            Add <code>mcpServers</code> to an agent (or project-wide) in{' '}
            <code>.orion/config.yaml</code>. Agent-level entries win on a name conflict. Use{' '}
            <code>command</code>/<code>args</code>/<code>env</code> for stdio servers, or{' '}
            <code>url</code>/<code>bearerToken</code> for HTTP servers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock code={agentYaml} />
        </CardContent>
      </Card>

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

              <TabsContent value="custom" className="flex flex-col gap-3 mt-3 flex-1 min-h-0">
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
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">Bearer token (optional)</Label>
                      <Input
                        value={customToken}
                        onChange={(e) => setCustomToken(e.target.value)}
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
                <DialogFooter className="mt-auto">
                  <Button variant="outline" size="sm" onClick={resetAddDialog}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={addCustom} disabled={!customName.trim()}>
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

              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                  <InfoIcon className="size-3.5 shrink-0 mt-0.5" />
                  After adding this server, agents will call its tools automatically during runs.
                  You can verify connectivity by running an agent ticket with this server enabled
                  and checking the run logs for MCP tool invocations.
                </p>
              </div>

              <DialogFooter className="shrink-0">
                <Button variant="outline" size="sm" onClick={() => setOauthStep('select')}>
                  Back
                </Button>
                <Button size="sm" onClick={finishCatalogEntry}>
                  Connect &amp; Add Server
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
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Bearer token (optional)</Label>
                <Input
                  value={editBearerToken}
                  onChange={(e) => setEditBearerToken(e.target.value)}
                  placeholder="${TOKEN}"
                  className="h-8"
                />
              </div>
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
    </div>
  );
}
