import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HarnessRegistry } from '@orion/harness-core';
import type { ProviderRepository } from '@orion/db';
import type { Provider } from '@orion/models';
import { HarnessTextGenerator } from './agent-text.js';
import type { OrionEnv } from '../env.js';

function makeFakeHarness(key: string) {
  const run = vi.fn().mockResolvedValue({ finalResponse: '  result from harness  ' });
  return { key, run, runStreamed: vi.fn() };
}

function makeEnv(overrides?: Partial<OrionEnv>): OrionEnv {
  return {
    host: 'localhost',
    port: 0,
    databaseUrl: 'pglite://memory',
    workspaceDir: '/tmp/ws',
    projectsDir: '/tmp/projects',
    maxConcurrentRuns: 0,
    publicUrl: 'http://localhost:0',
    codebaseMcpEnabled: false,
    boardSyncIntervalMs: 600000,
    ...overrides,
  };
}

function makeProvider(overrides?: Partial<Provider>): Provider {
  return {
    id: 'prov-1',
    key: 'deepseek',
    label: 'DeepSeek',
    harness: 'codex',
    models: [],
    hasApiKey: false,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  };
}

describe('HarnessTextGenerator', () => {
  let harnesses: HarnessRegistry;
  let codexHarness: ReturnType<typeof makeFakeHarness>;
  let claudeHarness: ReturnType<typeof makeFakeHarness>;
  let providers: ProviderRepository;

  beforeEach(() => {
    harnesses = new HarnessRegistry();
    codexHarness = makeFakeHarness('codex');
    claudeHarness = makeFakeHarness('claude');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    harnesses.register(codexHarness as any).register(claudeHarness as any);
    providers = {
      list: vi.fn().mockResolvedValue([]),
      getApiKey: vi.fn().mockResolvedValue(null),
    } as unknown as ProviderRepository;
  });

  it('falls back to the first registered harness when no provider is given', async () => {
    const gen = new HarnessTextGenerator(harnesses, providers, makeEnv());
    await gen.generate({ prompt: 'hi', workingDirectory: '/tmp' });
    expect(codexHarness.run).toHaveBeenCalled();
  });

  it('passes through a registered harness key directly', async () => {
    const gen = new HarnessTextGenerator(harnesses, providers, makeEnv());
    await gen.generate({ prompt: 'hi', workingDirectory: '/tmp', provider: 'claude' });
    expect(claudeHarness.run).toHaveBeenCalled();
  });

  it('resolves a DB provider key → harness', async () => {
    const dbProvider = makeProvider({ key: 'deepseek', harness: 'codex' });
    vi.mocked(providers.list).mockResolvedValue([dbProvider]);
    const gen = new HarnessTextGenerator(harnesses, providers, makeEnv());
    await gen.generate({ prompt: 'hi', workingDirectory: '/tmp', provider: 'deepseek' });
    expect(codexHarness.run).toHaveBeenCalled();
  });

  it('uses DB provider baseUrl', async () => {
    const dbProvider = makeProvider({ key: 'deepseek', harness: 'codex', baseUrl: 'https://deepseek.api' });
    vi.mocked(providers.list).mockResolvedValue([dbProvider]);
    const gen = new HarnessTextGenerator(harnesses, providers, makeEnv({ codexBaseUrl: 'https://fallback.api' }));
    await gen.generate({ prompt: 'hi', workingDirectory: '/tmp', provider: 'deepseek' });
    expect(codexHarness.run).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ baseUrl: 'https://deepseek.api' }),
    );
  });

  it('falls back to env baseUrl for a known harness when DB provider has none', async () => {
    const dbProvider = makeProvider({ key: 'deepseek', harness: 'codex' });
    vi.mocked(providers.list).mockResolvedValue([dbProvider]);
    const env = makeEnv({ codexBaseUrl: 'https://env-codex.api', claudeBaseUrl: 'https://env-claude.api' });
    const gen = new HarnessTextGenerator(harnesses, providers, env);
    await gen.generate({ prompt: 'hi', workingDirectory: '/tmp', provider: 'deepseek' });
    expect(codexHarness.run).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ baseUrl: 'https://env-codex.api' }),
    );
  });

  it('falls back to env baseUrl for a harness passed directly as provider', async () => {
    const env = makeEnv({ codexBaseUrl: 'https://env-codex.api' });
    const gen = new HarnessTextGenerator(harnesses, providers, env);
    await gen.generate({ prompt: 'hi', workingDirectory: '/tmp', provider: 'codex' });
    expect(codexHarness.run).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ baseUrl: 'https://env-codex.api' }),
    );
  });

  it('uses DB provider stored API key (decrypted when salt is set)', async () => {
    const dbProvider = makeProvider({ key: 'deepseek', harness: 'codex', hasApiKey: true });
    vi.mocked(providers.list).mockResolvedValue([dbProvider]);
    vi.mocked(providers.getApiKey).mockResolvedValue('decrypted-key');
    const gen = new HarnessTextGenerator(harnesses, providers, makeEnv());
    await gen.generate({ prompt: 'hi', workingDirectory: '/tmp', provider: 'deepseek' });
    expect(codexHarness.run).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ apiKey: 'decrypted-key' }),
    );
  });

  it('falls back to env apiKey for harness when DB has no stored key', async () => {
    const env = makeEnv({ codexApiKey: 'env-codex-key' });
    const gen = new HarnessTextGenerator(harnesses, providers, env);
    await gen.generate({ prompt: 'hi', workingDirectory: '/tmp', provider: 'codex' });
    expect(codexHarness.run).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ apiKey: 'env-codex-key' }),
    );
  });

  it('throws when no harness providers are registered', async () => {
    const emptyRegistry = new HarnessRegistry();
    const gen = new HarnessTextGenerator(emptyRegistry, providers, makeEnv());
    await expect(gen.generate({ prompt: 'hi', workingDirectory: '/tmp' })).rejects.toThrow(
      'no harness provider available to generate content',
    );
  });

  it('falls back to the first harness when provider is unknown', async () => {
    const dbProvider = makeProvider({ key: 'deepseek', harness: 'codex' });
    vi.mocked(providers.list).mockResolvedValue([dbProvider]);
    const gen = new HarnessTextGenerator(harnesses, providers, makeEnv());
    const result = await gen.generate({ prompt: 'hi', workingDirectory: '/tmp', provider: 'unknown' });
    expect(result).toBe('result from harness');
    expect(codexHarness.run).toHaveBeenCalled();
  });
});
