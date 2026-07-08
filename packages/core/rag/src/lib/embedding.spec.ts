import { describe, expect, it } from 'vitest';
import { LocalEmbeddingProvider } from './embedding.js';
import { cosineSimilarity } from './similarity.js';

describe('LocalEmbeddingProvider', () => {
  const provider = new LocalEmbeddingProvider(256);

  it('exposes a stable id and dimensions', () => {
    expect(provider.id).toBe('local');
    expect(provider.dimensions).toBe(256);
  });

  it('emits vectors of the configured dimension', async () => {
    const [vec] = await provider.embed(['hello world function']);
    expect(vec).toHaveLength(256);
  });

  it('is deterministic across calls', async () => {
    const [a] = await provider.embed(['const value = compute(input)']);
    const [b] = await provider.embed(['const value = compute(input)']);
    expect(a).toEqual(b);
  });

  it('L2-normalizes non-empty text', async () => {
    const [vec] = await provider.embed(['authentication login session token']);
    const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(mag).toBeCloseTo(1, 6);
  });

  it('produces a zero vector for text with no tokens', async () => {
    const [vec] = await provider.embed(['   !!!   ']);
    expect(vec.every((v) => v === 0)).toBe(true);
  });

  it('ranks similar texts higher than dissimilar ones', async () => {
    const query = 'function to parse and validate a JSON config file';
    const similar = 'this parses a JSON configuration file and validates it';
    const dissimilar = 'the quick brown fox jumps over the lazy dog at night';
    const [q, s, d] = await provider.embed([query, similar, dissimilar]);
    expect(cosineSimilarity(q, s)).toBeGreaterThan(cosineSimilarity(q, d));
  });
});
