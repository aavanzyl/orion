import { useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import type { McpServerConfig } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { MCP_CATALOG } from './mcp-catalog';

export type McpCatalogEntry = typeof MCP_CATALOG[number];

export interface McpServersEditorProps {
  mcpServers: Record<string, McpServerConfig>;
  onChange: (servers: Record<string, McpServerConfig>) => void;
  /**
   * When provided, the "From catalog" button delegates to the parent instead of
   * opening a nested dialog. Use with {@link McpCatalogList} to render the picker
   * inline (e.g. by swapping the surrounding dialog's content).
   */
  onRequestAddCatalog?: () => void;
  /**
   * When provided, the "Custom" button delegates to the parent instead of
   * opening a nested dialog. Use with {@link McpCustomForm}.
   */
  onRequestAddCustom?: () => void;
}

function isStdio(c: McpServerConfig) {
  return typeof c.command === 'string' && c.command.length > 0;
}

function summary(c: McpServerConfig) {
  if (isStdio(c)) {
    const args = (c.args ?? []).join(' ');
    return args ? `${c.command} ${args}` : (c.command ?? '');
  }
  if (typeof c.url === 'string' && c.url.length > 0) return c.url;
  return '—';
}

export function McpCatalogList({
  mcpServers,
  onAdd,
}: {
  mcpServers: Record<string, McpServerConfig>;
  onAdd: (entry: McpCatalogEntry) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-2">
      {MCP_CATALOG.map((entry) => {
        const alreadyAdded = entry.key in mcpServers;
        return (
          <button
            key={entry.key}
            type="button"
            disabled={alreadyAdded}
            onClick={() => onAdd(entry)}
            className={`text-left rounded-md border p-3 hover:border-primary/50 transition-colors ${
              alreadyAdded ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-muted/50'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{entry.title}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
                {entry.key}
              </span>
              {alreadyAdded && (
                <span className="text-[10px] text-muted-foreground ml-auto">Added</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{entry.description}</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {entry.tools.slice(0, 5).map((t) => (
                <span key={t} className="rounded bg-muted/50 px-1 py-0.5 text-[10px] text-muted-foreground font-mono">
                  {t}
                </span>
              ))}
              {entry.tools.length > 5 && (
                <span className="text-[10px] text-muted-foreground">
                  +{entry.tools.length - 5} more
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function McpCustomForm({
  onAdd,
  onCancel,
  cancelLabel = 'Cancel',
}: {
  onAdd: (name: string, config: McpServerConfig) => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const [customName, setCustomName] = useState('');
  const [customMode, setCustomMode] = useState<'stdio' | 'http'>('stdio');
  const [customCommand, setCustomCommand] = useState('');
  const [customArgs, setCustomArgs] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customToken, setCustomToken] = useState('');

  const submit = () => {
    const name = customName.trim();
    if (!name) return;
    const config: McpServerConfig =
      customMode === 'stdio'
        ? { command: customCommand.trim(), args: customArgs.trim() ? customArgs.trim().split(/\s+/) : [] }
        : { url: customUrl.trim(), ...(customToken.trim() ? { bearerToken: customToken.trim() } : {}) };
    onAdd(name, config);
  };

  return (
    <>
      <div className="flex flex-col gap-3">
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
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button size="sm" onClick={submit} disabled={!customName.trim()}>
          Add
        </Button>
      </DialogFooter>
    </>
  );
}

export function McpServersEditor({
  mcpServers,
  onChange,
  onRequestAddCatalog,
  onRequestAddCustom,
}: McpServersEditorProps) {
  const [showCatalog, setShowCatalog] = useState(false);
  const [showCustom, setShowCustom] = useState(false);

  const entries = Object.entries(mcpServers);

  const remove = (key: string) => {
    const next = { ...mcpServers };
    delete next[key];
    onChange(next);
  };

  const addFromCatalog = (entry: McpCatalogEntry) => {
    onChange({ ...mcpServers, [entry.key]: entry.config });
    setShowCatalog(false);
  };

  const addCustom = (name: string, config: McpServerConfig) => {
    onChange({ ...mcpServers, [name]: config });
    setShowCustom(false);
  };

  return (
    <div className="flex flex-col gap-2">
      {entries.length > 0 ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Details</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(([key, config]) => (
                <TableRow key={key}>
                  <TableCell>
                    <span className="font-mono text-sm font-medium">{key}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={isStdio(config) ? 'default' : 'secondary'}>
                      {isStdio(config) ? 'stdio' : 'http'}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                    <code className="text-[11px]">{summary(config)}</code>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(key)}
                      aria-label={`Remove ${key}`}
                    >
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="py-2 text-center text-xs text-muted-foreground">No MCP servers added.</p>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={onRequestAddCatalog ?? (() => setShowCatalog(true))}
        >
          <PlusIcon data-icon="inline-start" />
          From catalog
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={onRequestAddCustom ?? (() => setShowCustom(true))}
        >
          <PlusIcon data-icon="inline-start" />
          Custom
        </Button>
      </div>

      {!onRequestAddCatalog && (
        <Dialog open={showCatalog} onOpenChange={setShowCatalog}>
          <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Add MCP Server</DialogTitle>
              <DialogDescription>
                Select a pre-configured MCP server from the catalog.
              </DialogDescription>
            </DialogHeader>
            <McpCatalogList mcpServers={mcpServers} onAdd={addFromCatalog} />
          </DialogContent>
        </Dialog>
      )}

      {!onRequestAddCustom && (
        <Dialog open={showCustom} onOpenChange={setShowCustom}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Add Custom MCP Server</DialogTitle>
              <DialogDescription>
                Configure a stdio or HTTP MCP server.
              </DialogDescription>
            </DialogHeader>
            <McpCustomForm onAdd={addCustom} onCancel={() => setShowCustom(false)} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
