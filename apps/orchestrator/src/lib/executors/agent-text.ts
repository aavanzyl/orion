import type { HarnessRegistry } from '@orion/harness-core';
import type { ProviderRepository } from '@orion/db';
import { decrypt } from '../crypto.js';
import type { OrionEnv } from '../env.js';

/**
 * Generates a short piece of text (a PR title/body, a status message, …) by
 * running a harness turn. This is the "toggle only" agentic seam: nodes that opt
 * into agent-generated content call this instead of exposing full agent config.
 * The provider defaults to the first registered harness when the node does not
 * name one, so users only have to flip a switch.
 */
export interface AgentTextGenerator {
  generate(input: AgentTextRequest): Promise<string>;
}

interface AgentTextRequest {
  /** Prompt describing what to write. */
  prompt: string;
  /** Directory the harness runs in (the run's worktree). */
  workingDirectory: string;
  /** Optional provider override; defaults to the first registered harness. */
  provider?: string;
  /** Optional model override. */
  model?: string;
  /** Abort signal to cancel the turn. */
  signal?: AbortSignal;
}

/**
 * Default {@link AgentTextGenerator} backed by the harness registry. Resolves a
 * provider from the request or the first registered harness, runs a single
 * non-streamed turn, and returns the trimmed final response.
 */
export class HarnessTextGenerator implements AgentTextGenerator {
  constructor(
    private readonly harnesses: HarnessRegistry,
    private readonly providers: ProviderRepository,
    private readonly env: OrionEnv,
  ) {}

  async generate(input: AgentTextRequest): Promise<string> {
    const { harnessKey, baseUrl } = await this.resolveProvider(input.provider);
    if (!harnessKey) {
      throw new Error('no harness provider available to generate content');
    }
    const harnessInstance = this.harnesses.get(harnessKey);
    const apiKey = await this.resolveApiKey(harnessKey);
    const result = await harnessInstance.run(input.prompt, {
      workingDirectory: input.workingDirectory,
      model: input.model,
      baseUrl,
      apiKey,
      signal: input.signal,
    });
    return result.finalResponse.trim();
  }

  private async resolveProvider(provider?: string): Promise<{ harnessKey?: string; baseUrl?: string }> {
    let harnessKey: string | undefined;
    let baseUrl: string | undefined;

    if (provider) {
      if (this.harnesses.has(provider)) {
        harnessKey = provider;
        baseUrl = provider === 'codex' ? this.env.codexBaseUrl
          : provider === 'claude' ? this.env.claudeBaseUrl
          : undefined;
      } else {
        const dbProvider = await this.resolveDbProvider(provider);
        if (dbProvider?.harness && this.harnesses.has(dbProvider.harness)) {
          harnessKey = dbProvider.harness;
          baseUrl = dbProvider.baseUrl
            || (dbProvider.harness === 'codex' ? this.env.codexBaseUrl : undefined)
            || (dbProvider.harness === 'claude' ? this.env.claudeBaseUrl : undefined);
        }
      }
    }

    if (!harnessKey) {
      const keys = this.harnesses.keys();
      if (keys.length > 0) {
        harnessKey = keys[0];
      }
    }

    return { harnessKey, baseUrl };
  }

  private async resolveDbProvider(providerKey: string) {
    const allProviders = await this.providers.list().catch(() => []);
    return allProviders.find((p) => p.key === providerKey);
  }

  private async resolveApiKey(harnessKey: string): Promise<string | undefined> {
    const allProviders = await this.providers.list().catch(() => []);
    const matching = allProviders.find((p) => p.harness === harnessKey);
    if (matching) {
      const stored = await this.providers.getApiKey(matching.id).catch(() => null);
      if (stored) {
        return this.env.providerEncryptionSalt
          ? decrypt(stored, this.env.providerEncryptionSalt)
          : stored;
      }
    }
    if (harnessKey === 'codex') return this.env.codexApiKey;
    if (harnessKey === 'claude') return this.env.claudeApiKey;
    return undefined;
  }
}
