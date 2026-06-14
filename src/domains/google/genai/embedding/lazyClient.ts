/**
 * Lazy EmbeddingClient facade (Increment C §1; first-use splitting, mirrors
 * lazyClient.ts:17): implements the EmbeddingClient contract over a one-time
 * dynamic import of GeminiEmbeddingClient, so the composition root
 * (src/app/google/wireGoogle.ts) can install the client at boot WITHOUT
 * pulling the embedding implementation into the entry chunk — it loads on the
 * first actual embed call. Check 4 of scripts/check-worker-chunk.mjs asserts
 * GeminiEmbeddingClient stays out of the emitted entry closure.
 *
 * `isConfigured()` is answered locally from the injected config provider (a
 * synchronous contract method must not wait for a chunk).
 */
import type { EmbeddingClient, EmbeddingProfile } from './contract';
import type { GeminiEmbeddingClientDeps } from './GeminiEmbeddingClient';

export function makeLazyEmbeddingClient(deps: GeminiEmbeddingClientDeps): EmbeddingClient {
  let clientPromise: Promise<EmbeddingClient> | null = null;
  const load = (): Promise<EmbeddingClient> =>
    (clientPromise ??= import('./GeminiEmbeddingClient').then(
      (m) => new m.GeminiEmbeddingClient(deps),
    ));

  return {
    embed(
      texts: string[],
      opts: {
        profile: EmbeddingProfile;
        bookId?: string;
        interactive?: boolean;
        signal?: AbortSignal;
      },
    ): Promise<{ vectors: Float32Array[] }> {
      return load().then((client) => client.embed(texts, opts));
    },
    isConfigured(): boolean {
      const { apiKey } = deps.getConfig();
      return Boolean(apiKey);
    },
  };
}
