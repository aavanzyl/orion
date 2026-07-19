import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('schedule resolution (unit)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it('resolveApiKey returns stored DB provider key for a known harness', async () => {
    await ctx.container.providers.create({
      key: 'deepseek',
      label: 'DeepSeek',
      harness: 'codex',
      models: ['deepseek-chat'],
      apiKey: 'sk-deepseek-test-key',
    });

    const key = await (ctx.schedules as any).resolveApiKey('codex');
    expect(key).toBe('sk-deepseek-test-key');
  });

  it('resolveApiKey falls back to env when no DB provider matches', async () => {
    const key = await (ctx.schedules as any).resolveApiKey('claude');
    expect(key).toBeUndefined();
  });

  it('resolveDbProvider finds a provider by its key', async () => {
    await ctx.container.providers.create({
      key: 'openai',
      label: 'OpenAI',
      harness: 'codex',
      models: ['gpt-4'],
      apiKey: 'sk-openai-test-key',
    });

    const found = await (ctx.schedules as any).resolveDbProvider('openai');
    expect(found).toBeDefined();
    expect(found.key).toBe('openai');
    expect(found.harness).toBe('codex');
  });

  it('resolveDbProvider returns undefined for unknown keys', async () => {
    const found = await (ctx.schedules as any).resolveDbProvider('nonexistent');
    expect(found).toBeUndefined();
  });

  it('resolveProvider maps a DB provider key to the backing harness', async () => {
    await ctx.container.providers.create({
      key: 'my-deepseek',
      label: 'My DeepSeek',
      harness: 'codex',
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat'],
      apiKey: 'sk-db-key',
    });

    const result = await (ctx.schedules as any).resolveProvider('my-deepseek');
    expect(result).toBeDefined();
    expect(result.resolvedProvider).toBe('codex');
    expect(result.harness).toBeDefined();
    expect(result.baseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('resolveProvider uses the node baseUrl override even with a DB provider', async () => {
    await ctx.container.providers.create({
      key: 'deepseek2',
      label: 'DeepSeek 2',
      harness: 'codex',
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat'],
      apiKey: 'sk-db-key',
    });

    const result = await (ctx.schedules as any).resolveProvider('deepseek2', 'https://custom.example.com/v1');
    expect(result.resolvedProvider).toBe('codex');
    expect(result.baseUrl).toBe('https://custom.example.com/v1');
  });

  it('resolveProvider returns the harness directly when the name is a known harness', async () => {
    const result = await (ctx.schedules as any).resolveProvider('codex');
    expect(result.resolvedProvider).toBe('codex');
    expect(result.harness).toBeDefined();
  });
});
