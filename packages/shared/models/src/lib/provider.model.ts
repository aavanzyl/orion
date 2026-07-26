export type ProviderId = string;

/**
 * A configurable AI provider entry that powers autocomplete in the config
 * wizard. `key` is the model provider identifier (e.g. `openai`, `deepseek`);
 * `harness` is the SDK runtime used to execute agents (e.g. `codex`);
 * `models` are the identifiers offered for that provider.
 */
export interface Provider {
  id: ProviderId;
  key: string;
  label: string;
  /** SDK runtime: `codex`, `claude`, `opencode`. */
  harness?: string;
  baseUrl?: string;
  models: string[];
  /** When set the provider has a stored API key (never returned in plaintext). */
  hasApiKey: boolean;
  /** Custom input/prompt price in USD per 1M tokens. Overrides SDK-reported cost. */
  promptPrice?: number;
  /** Custom output/completion price in USD per 1M tokens. Overrides SDK-reported cost. */
  completionPrice?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProviderInput {
  key: string;
  label?: string;
  harness?: string;
  baseUrl?: string;
  models?: string[];
  apiKey?: string;
  promptPrice?: number;
  completionPrice?: number;
}

/** Mutable fields of a provider. All optional — only provided fields change. */
export interface UpdateProviderInput {
  key?: string;
  label?: string;
  harness?: string;
  baseUrl?: string;
  models?: string[];
  apiKey?: string;
  promptPrice?: number | null;
  completionPrice?: number | null;
}

/**
 * The agent harness that best fits a given model provider. OpenAI-family
 * providers default to Codex (OpenAI's own agent SDK); every other provider
 * defaults to the Claude Agent SDK, which drives non-OpenAI models (DeepSeek,
 * Anthropic, etc.) more reliably than Codex.
 */
export function defaultHarnessForProvider(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'codex' || normalized === 'azure') {
    return 'codex';
  }
  return 'claude';
}
