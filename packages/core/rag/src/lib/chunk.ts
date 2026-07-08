import type { CodeChunkInput } from './types.js';

export interface ChunkOptions {
  /** Maximum number of lines per chunk. */
  maxLines?: number;
  /** Maximum number of characters per chunk (splits large lines windows). */
  maxChars?: number;
  /** Number of trailing lines from the previous chunk to repeat as overlap. */
  overlapLines?: number;
}

const DEFAULT_MAX_LINES = 60;
const DEFAULT_MAX_CHARS = 1500;
const DEFAULT_OVERLAP_LINES = 8;

/**
 * Split a text file into line-window chunks. Windows are capped by both a line
 * count and a character budget, with a small line overlap so context spanning a
 * boundary is not lost. Blank/whitespace-only files yield no chunks.
 */
export function chunkFile(
  filePath: string,
  content: string,
  opts: ChunkOptions = {},
): CodeChunkInput[] {
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapLines = Math.min(opts.overlapLines ?? DEFAULT_OVERLAP_LINES, Math.max(maxLines - 1, 0));

  if (content.trim().length === 0) return [];

  const lines = content.split('\n');
  const chunks: CodeChunkInput[] = [];
  let chunkIndex = 0;
  let start = 0;

  while (start < lines.length) {
    let end = start;
    let charCount = 0;
    // Grow the window until we hit the line or character budget.
    while (end < lines.length && end - start < maxLines) {
      const next = charCount + lines[end].length + 1;
      if (end > start && next > maxChars) break;
      charCount = next;
      end++;
    }
    if (end === start) end = start + 1;

    const windowLines = lines.slice(start, end);
    const text = windowLines.join('\n');
    if (text.trim().length > 0) {
      chunks.push({
        filePath,
        chunkIndex: chunkIndex++,
        startLine: start + 1,
        endLine: end,
        content: text,
      });
    }

    if (end >= lines.length) break;
    const nextStart = end - overlapLines;
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}
