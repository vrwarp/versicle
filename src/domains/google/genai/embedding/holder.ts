/**
 * Composition holder for the EmbeddingClient singleton (Increment C §1),
 * mirroring the GenAIClient holder (holder.ts:19). The REAL client (the lazy
 * GeminiEmbeddingClient facade with the useGenAIStore-backed config provider +
 * log sink) is installed by src/app/google/wireGoogle.ts; the fallback is an
 * inline NOT-CONFIGURED client (isConfigured() === false, embed() throws
 * GENAI_EMBEDDING_NOT_CONFIGURED) so stray imports degrade exactly like a
 * missing API key instead of crashing.
 *
 * The fallback deliberately does NOT construct GeminiEmbeddingClient — this
 * holder rides the entry chunk, and a static import here would defeat the
 * first-use split (check 4 of scripts/check-worker-chunk.mjs).
 */
import type { EmbeddingClient } from './contract';
import { EmbeddingNotConfiguredError } from './errors';

const notConfiguredClient: EmbeddingClient = {
  embed: async () => {
    throw new EmbeddingNotConfiguredError();
  },
  isConfigured: () => false,
};

let instance: EmbeddingClient | null = null;

export function setEmbeddingClient(client: EmbeddingClient): void {
  instance = client;
}

export function getEmbeddingClient(): EmbeddingClient {
  // Not memoized: a later wireGoogle/setEmbeddingClient still wins.
  return instance ?? notConfiguredClient;
}
