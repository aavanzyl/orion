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
}

/** Mutable fields of a provider. All optional — only provided fields change. */
export interface UpdateProviderInput {
  key?: string;
  label?: string;
  harness?: string;
  baseUrl?: string;
  models?: string[];
  apiKey?: string;
}
