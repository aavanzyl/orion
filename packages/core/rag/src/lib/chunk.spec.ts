import { describe, expect, it } from 'vitest';
import { chunkFile } from './chunk.js';

describe('chunkFile', () => {
  it('returns no chunks for empty or whitespace content', () => {
    expect(chunkFile('a.ts', '')).toEqual([]);
    expect(chunkFile('a.ts', '   \n\n  \t')).toEqual([]);
  });

  it('produces a single chunk for a small file', () => {
    const content = 'line1\nline2\nline3';
    const chunks = chunkFile('a.ts', content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      filePath: 'a.ts',
      chunkIndex: 0,
      startLine: 1,
      endLine: 3,
      content,
    });
  });

  it('splits into line windows with overlap', () => {
    const lines = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`);
    const chunks = chunkFile('big.ts', lines.join('\n'), {
      maxLines: 50,
      overlapLines: 10,
      maxChars: 100000,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(50);
    // Second chunk starts overlapping the tail of the first.
    expect(chunks[1].startLine).toBe(41);
    // Chunk indices are sequential.
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
    // Coverage reaches the last line.
    expect(chunks[chunks.length - 1].endLine).toBe(150);
  });

  it('respects the character budget within a line window', () => {
    const lines = Array.from({ length: 40 }, () => 'x'.repeat(200));
    const chunks = chunkFile('wide.ts', lines.join('\n'), {
      maxLines: 60,
      maxChars: 1000,
      overlapLines: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(1200);
    }
  });
});
