import { useState } from 'react';
import { InfoIcon, LockIcon, PlusIcon, XIcon } from 'lucide-react';
import type { HttpMethod } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { configString, FieldLabel, NumberField, type NodeTypeEditorProps, setConfig } from './fields';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

export function HeadersEditor({
  headers,
  onChange,
}: {
  headers: Record<string, string>;
  onChange: (headers: Record<string, string> | undefined) => void;
}) {
  const entries = Object.entries(headers);
  const setKey = (oldKey: string, newKey: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of entries) next[k === oldKey ? newKey : k] = v;
    onChange(next);
  };
  const setValue = (key: string, value: string) => onChange({ ...headers, [key]: value });
  const remove = (key: string) => {
    const next = { ...headers };
    delete next[key];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  const add = () => {
    let key = 'X-Header';
    let i = 1;
    while (key in headers) {
      i += 1;
      key = `X-Header-${i}`;
    }
    onChange({ ...headers, [key]: '' });
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      {entries.length === 0 && <p className="text-[11px] text-muted-foreground">No headers.</p>}
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-1.5">
          <Input
            value={key}
            onChange={(e) => setKey(key, e.target.value)}
            className="h-8 flex-1"
            placeholder="Header"
          />
          <Input
            value={value}
            onChange={(e) => setValue(key, e.target.value)}
            className="h-8 flex-1"
            placeholder="value"
          />
          <Button variant="ghost" size="icon-sm" onClick={() => remove(key)} aria-label="Remove header">
            <XIcon />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add}>
        <PlusIcon data-icon="inline-start" />
        Add header
      </Button>
    </div>
  );
}

export function TokenField({
  token,
  onChange,
}: {
  token: string | undefined;
  onChange: (token: string | undefined) => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const encrypted = Boolean(token && token.startsWith('aes256:'));

  const encryptAndStore = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.encryptSecret(draft.trim());
      onChange(res.value);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to encrypt');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <FieldLabel>Bearer token</FieldLabel>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground cursor-help"><InfoIcon className="size-3" /></span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            The token is encrypted with the server key before it is stored in your config, and decrypted only in-process at run time.
          </TooltipContent>
        </Tooltip>
      </div>
      {token ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
          <LockIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate font-mono">
            {encrypted ? 'Encrypted token stored' : 'Token stored (not encrypted — no server key)'}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => onChange(undefined)} aria-label="Clear token">
            <XIcon />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste token to encrypt & store"
          />
          <Button variant="outline" size="sm" onClick={encryptAndStore} disabled={busy || !draft.trim()}>
            {busy ? 'Encrypting…' : 'Encrypt'}
          </Button>
        </div>
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

export function HttpProperties({ data, onChange }: NodeTypeEditorProps) {
  const showBody = data.method && data.method !== 'GET' && data.method !== 'HEAD';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>URL</FieldLabel>
        <Input
          value={data.url ?? ''}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder="https://api.example.com/hook"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Method</FieldLabel>
        <Select value={data.method ?? 'GET'} onValueChange={(v) => onChange({ method: v as HttpMethod })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HTTP_METHODS.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Headers</FieldLabel>
        <HeadersEditor headers={data.headers ?? {}} onChange={(headers) => onChange({ headers })} />
      </div>
      {showBody && (
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Body</FieldLabel>
          <Textarea
            value={data.body ?? ''}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder={'{"key": "{{ nodes.plan.data.value }}"}'}
            className="min-h-20 font-mono text-xs"
            spellCheck={false}
          />
        </div>
      )}
      <TokenField token={data.token} onChange={(token) => onChange({ token })} />
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Query params (optional)</FieldLabel>
        <Textarea
          value={configString(data.config, 'queryParams')}
          onChange={(e) =>
            onChange({
              config: setConfig(data.config, 'queryParams', e.target.value || undefined),
            })
          }
          placeholder="page=1&limit=10"
          className="min-h-20 font-mono text-xs"
          spellCheck={false}
        />
        <p className="text-[11px] text-muted-foreground">
          Key=value pairs, one per line.
        </p>
      </div>
      <NumberField
        label="Expected status"
        value={
          typeof data.config?.expectedStatus === 'number'
            ? (data.config.expectedStatus as number)
            : undefined
        }
        onChange={(v) =>
          onChange({
            config: setConfig(data.config, 'expectedStatus', v),
          })
        }
        placeholder="e.g. 200"
      />
      <p className="-mt-3 text-[11px] text-muted-foreground">
        Treats non-matching status as failure even on 2xx. Leave empty to accept any 2xx.
      </p>
      <NumberField
        label="Timeout (ms)"
        value={
          typeof data.config?.timeoutMs === 'number'
            ? (data.config.timeoutMs as number)
            : undefined
        }
        onChange={(v) =>
          onChange({
            config: setConfig(data.config, 'timeoutMs', v),
          })
        }
      />
      <p className="-mt-3 text-[11px] text-muted-foreground">
        Request-specific timeout. Falls back to the node timeout when unset.
      </p>
    </div>
  );
}
