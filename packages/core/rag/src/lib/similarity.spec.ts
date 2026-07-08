import { describe, expect, it } from 'vitest';
import { cosineSimilarity, rankBySimilarity } from './similarity.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('returns 1 for parallel vectors of different magnitude', () => {
    expect(cosineSimilarity([1, 0, 0], [5, 0, 0])).toBeCloseTo(1, 10);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('returns 0 for zero-magnitude or mismatched vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('is negative for opposite vectors', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 10);
  });
});

describe('rankBySimilarity', () => {
  const chunks = [
    { id: 'a', embedding: [1, 0, 0] },
    { id: 'b', embedding: [0.9, 0.1, 0] },
    { id: 'c', embedding: [0, 1, 0] },
    { id: 'd', embedding: [0, 0, 1] },
  ];

  it('orders by descending similarity and honours topK', () => {
    const ranked = rankBySimilarity([1, 0, 0], chunks, 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].item.id).toBe('a');
    expect(ranked[1].item.id).toBe('b');
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });

  it('returns all items when topK <= 0', () => {
    expect(rankBySimilarity([1, 0, 0], chunks, 0)).toHaveLength(chunks.length);
  });
});
