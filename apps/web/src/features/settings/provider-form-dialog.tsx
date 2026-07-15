import { useEffect, useRef, useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Provider } from '@orion/models';
import { defaultHarnessForProvider } from '@orion/models';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

const HARNESS_OPTIONS = ['codex', 'claude', 'opencode'];

interface KnownProvider {
  label: string;
  baseUrl: string;
}

const KNOWN_PROVIDERS: Record<string, KnownProvider> = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { label: 'Anthropic', baseUrl: '' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic' },
  google: { label: 'Google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  together: { label: 'Together AI', baseUrl: 'https://api.together.xyz/v1' },
  perplexity: { label: 'Perplexity', baseUrl: 'https://api.perplexity.ai' },
  cohere: { label: 'Cohere', baseUrl: 'https://api.cohere.ai/v1' },
  codex: { label: 'Codex', baseUrl: '' },
  xai: { label: 'xAI', baseUrl: 'https://api.x.ai/v1' },
  meta: { label: 'Meta', baseUrl: '' },
};

export interface ProviderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided the dialog edits this provider; otherwise it creates one. */
  provider?: Provider | null;
  onSaved: () => void;
}

export function ProviderFormDialog({
  open,
  onOpenChange,
  provider,
  onSaved,
}: ProviderFormDialogProps) {
  const editing = Boolean(provider);
  const [key, setKey] = useState('');
  const [harness, setHarness] = useState('');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [modelDraft, setModelDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const maskedKey = '••••••••••••';
  const hasStoredKey = provider?.hasApiKey ?? false;

  useEffect(() => {
    if (!open) return;
    setKey(provider?.key ?? '');
    setHarness(provider?.harness ?? '');
    setLabel(provider?.label ?? '');
    setBaseUrl(provider?.baseUrl ?? '');
    setApiKey('');
    setModels(provider?.models ?? []);
    setModelDraft('');
  }, [open, provider]);

  useEffect(() => {
    if (!open || editing) return;
    const info = KNOWN_PROVIDERS[key];
    if (info) {
      setHarness(defaultHarnessForProvider(key));
      setLabel(info.label);
      setBaseUrl(info.baseUrl);
    }
  }, [key, open, editing]);

  const addModel = () => {
    const value = modelDraft.trim();
    if (!value || models.includes(value)) {
      setModelDraft('');
      return;
    }
    setModels([...models, value]);
    setModelDraft('');
  };

  const removeModel = (model: string) => setModels(models.filter((m) => m !== model));

  const valid = key.trim().length > 0 && models.length > 0 && (editing || apiKey.trim().length > 0);

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      const payload = {
        key: key.trim(),
        harness: harness.trim() || undefined,
        label: label.trim(),
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        models,
      };
      if (editing && provider) {
        await api.updateProvider(provider.id, payload);
        toast.success('Provider updated');
      } else {
        await api.createProvider(payload);
        toast.success('Provider created');
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit provider' : 'Create provider'}</DialogTitle>
          <DialogDescription>
            The <strong>provider</strong> identifies which model provider to use
            (OpenAI, Anthropic, DeepSeek, etc.).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="provider-key">Provider</Label>
              <Select value={key || undefined} onValueChange={setKey} disabled={editing}>
                <SelectTrigger id="provider-key" className="w-full">
                  <SelectValue placeholder="Select a provider…" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KNOWN_PROVIDERS).map(([k, info]) => (
                    <SelectItem key={k} value={k}>
                      {info.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editing && (
                <p className="text-xs text-muted-foreground">
                  Provider key cannot be changed after creation.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Model provider identifier. {editing ? '' : 'Required.'}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="provider-harness">Harness</Label>
              <Select value={harness || undefined} onValueChange={setHarness}>
                <SelectTrigger id="provider-harness" className="w-full">
                  <SelectValue placeholder="Auto" />
                </SelectTrigger>
                <SelectContent>
                  {HARNESS_OPTIONS.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">SDK runtime. Optional.</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="provider-base-url">Base URL</Label>
            <Input
              id="provider-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
            <p className="text-xs text-muted-foreground">
              Optional OpenAI-compatible endpoint. Defaults to the selected provider's API.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="provider-api-key">
              API Key
              {!editing && <span className="text-destructive"> *</span>}
            </Label>
            <Input
              id="provider-api-key"
              ref={apiKeyInputRef}
              type="password"
              value={hasStoredKey && !apiKey ? maskedKey : apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onFocus={() => { if (hasStoredKey && !apiKey) apiKeyInputRef.current?.select(); }}
              placeholder="sk-..."
            />
            <p className="text-xs text-muted-foreground">
              {hasStoredKey
                ? 'An API key is stored. Enter a new one to replace it, or clear to remove. The key cannot be viewed again.'
                : 'The key is encrypted at rest and cannot be viewed after saving.'}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="provider-model">
              Models
              <span className="text-destructive"> *</span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="provider-model"
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addModel();
                  }
                }}
                placeholder="gpt-5-codex"
              />
              <Button type="button" variant="outline" onClick={addModel}>
                <PlusIcon data-icon="inline-start" />
                Add
              </Button>
            </div>
            {models.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {models.map((model) => (
                  <Badge key={model} variant="secondary" className="gap-1 font-mono">
                    {model}
                    <button
                      type="button"
                      onClick={() => removeModel(model)}
                      aria-label={`Remove ${model}`}
                      className="rounded-full hover:text-destructive"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !valid}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
