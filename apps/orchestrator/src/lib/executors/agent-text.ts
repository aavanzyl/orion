import type { HarnessRegistry } from '@orion/harness-core';
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
    private readonly env: OrionEnv,
  ) {}

  async generate(input: AgentTextRequest): Promise<string> {
    const provider = input.provider ?? this.harnesses.keys()[0];
    if (!provider) {
      throw new Error('no harness provider available to generate content');
    }
    const harness = this.harnesses.get(provider);
    const result = await harness.run(input.prompt, {
      workingDirectory: input.workingDirectory,
      model: input.model,
      baseUrl: this.env.codexBaseUrl,
      apiKey: this.env.codexApiKey,
      signal: input.signal,
    });
    return result.finalResponse.trim();
  }
}
