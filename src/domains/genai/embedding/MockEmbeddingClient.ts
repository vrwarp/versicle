/**
 * MockEmbeddingClient (Increment C §1) — a deterministic fixture
 * EmbeddingClient for the suite + the indexer test. Lives OUTSIDE the
 * production import graph (boundary rule 9, mirrors MockGenAIClient.ts:25):
 * reachable only from test files (and a future installTestApi seam).
 *
 * Vectors are hash-seeded unit vectors keyed by (text, profile), so the same
 * text+profile always yields the same vector — but the document and query
 * profiles diverge, exactly as the real asymmetric retrieval embeddings do.
 */
import type { EmbeddingClient, EmbeddingProfile } from './contract';

export interface MockEmbeddingFixture {
  /** Output dimensionality of the deterministic vectors (default 8). */
  dims?: number;
  /** When set, every embed call rejects with this message. */
  error?: string;
  /** Reports configured (default true). */
  configured?: boolean;
}

/** FNV-1a over a string → a 32-bit seed. */
function seedOf(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A tiny deterministic PRNG (mulberry32) so vectors are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MockEmbeddingClient implements EmbeddingClient {
  constructor(private readonly fixture: MockEmbeddingFixture = {}) {}

  isConfigured(): boolean {
    return this.fixture.configured ?? true;
  }

  async embed(
    texts: string[],
    opts: { profile: EmbeddingProfile },
  ): Promise<{ vectors: Float32Array[] }> {
    if (this.fixture.error) {
      throw new Error(this.fixture.error);
    }
    const dims = this.fixture.dims ?? 8;
    const vectors = texts.map((text) => this.unitVector(`${opts.profile}:${text}`, dims));
    return { vectors };
  }

  /** A deterministic L2-normalized vector seeded by `key`. */
  private unitVector(key: string, dims: number): Float32Array {
    const rng = mulberry32(seedOf(key));
    const vec = new Float32Array(dims);
    let sumSq = 0;
    for (let i = 0; i < dims; i++) {
      const v = rng() * 2 - 1;
      vec[i] = v;
      sumSq += v * v;
    }
    const norm = Math.sqrt(sumSq) || 1;
    for (let i = 0; i < dims; i++) vec[i] /= norm;
    return vec;
  }
}
