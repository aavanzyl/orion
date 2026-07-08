/**
 * Pluggable text embedding providers. Each provider maps text to a fixed-length
 * numeric vector; downstream code ranks chunks against a query with cosine
 * similarity, so any consistent vector space works.
 */
export interface EmbeddingProvider {
  /** Stable identifier of the vector space, e.g. `local` or `openai:text-embedding-3-small`. */
  readonly id: string;
  /** Dimensionality of the vectors this provider emits. */
  readonly dimensions: number;
  /** Embed a batch of texts, returning one vector per input in order. */
  embed(texts: string[]): Promise<number[][]>;
}

const DEFAULT_LOCAL_DIMENSIONS = 256;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 0);
}

/** Deterministic FNV-1a hash of a token into `[0, dimensions)`. */
function hashToken(token: string, dimensions: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % dimensions);
}

/**
 * Offline, deterministic embedding provider. Tokenizes text, hashes each token
 * into a fixed-dimension bucket, accumulates counts, then L2-normalizes. No
 * network access — used as a fallback and in tests.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'local';
  readonly dimensions: number;

  constructor(dimensions: number = DEFAULT_LOCAL_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.embedOne(text)));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    for (const token of tokenize(text)) {
      vec[hashToken(token, this.dimensions)] += 1;
    }
    let mag = 0;
    for (const v of vec) mag += v * v;
    mag = Math.sqrt(mag);
    if (mag === 0) return vec;
    for (let i = 0; i < vec.length; i++) vec[i] /= mag;
    return vec;
  }
}

export interface OpenAiEmbeddingOptions {
  apiKey: string;
  baseUrl: string;
  /** Embedding model id (default `text-embedding-3-small`). */
  model?: string;
  /** Reported dimensionality (default 1536 for text-embedding-3-small). */
  dimensions?: number;
  /** Texts embedded per HTTP request (default 96). */
  batchSize?: number;
}

interface OpenAiEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

const DEFAULT_OPENAI_MODEL = 'text-embedding-3-small';
const DEFAULT_OPENAI_DIMENSIONS = 1536;
const DEFAULT_BATCH_SIZE = 96;

/**
 * Embedding provider backed by an OpenAI-compatible `POST {baseUrl}/embeddings`
 * endpoint. Batches requests and uses the global `fetch`.
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly batchSize: number;

  constructor(opts: OpenAiEmbeddingOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.model = opts.model ?? DEFAULT_OPENAI_MODEL;
    this.dimensions = opts.dimensions ?? DEFAULT_OPENAI_DIMENSIONS;
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    this.id = `openai:${this.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      out.push(...(await this.embedBatch(batch)));
    }
    return out;
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: batch }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Embedding request failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    const body = (await response.json()) as OpenAiEmbeddingResponse;
    return body.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}
