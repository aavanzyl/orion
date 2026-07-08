import type { Ranked } from './types.js';

/**
 * Cosine similarity of two equal-length vectors. Returns a value in [-1, 1]
 * (1 = identical direction, 0 = orthogonal). Returns 0 when either vector has
 * zero magnitude or the lengths differ.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Rank items by cosine similarity of their embedding to `queryVec`, returning
 * the top `topK` in descending score order.
 */
export function rankBySimilarity<T extends { embedding: number[] }>(
  queryVec: number[],
  chunks: T[],
  topK: number,
): Array<Ranked<T>> {
  const scored = chunks.map((item) => ({ item, score: cosineSimilarity(queryVec, item.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  return topK > 0 ? scored.slice(0, topK) : scored;
}
