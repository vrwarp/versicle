/**
 * Lazy GenAI client facade (Phase 8 §A first-use splitting): implements the
 * GenAIClient contract over a one-time dynamic import of GeminiClient, so
 * the composition root (src/app/google/wireGoogle.ts) can install the
 * client at boot WITHOUT pulling the GenAI implementation into the entry
 * chunk — it loads on the first actual generate call. Check 4 of
 * scripts/check-worker-chunk.mjs asserts GeminiClient + the feature
 * modules stay out of the emitted entry closure.
 *
 * `isConfigured()` is answered locally from the injected config provider
 * (same logic as GeminiClient.isConfigured) — a synchronous contract
 * method must not wait for a chunk.
 */
import type { GenAIClient, GenAIRequest, GenAIRequestContext } from './contract';
import type { GeminiClientDeps } from './GeminiClient';

export function makeLazyGenAIClient(deps: GeminiClientDeps): GenAIClient {
  let clientPromise: Promise<GenAIClient> | null = null;
  const load = (): Promise<GenAIClient> =>
    (clientPromise ??= import('./GeminiClient').then((m) => new m.GeminiClient(deps)));

  return {
    generateStructured<T>(request: GenAIRequest<T>): Promise<T> {
      return load().then((client) => client.generateStructured(request));
    },
    generateText(prompt: string, context?: GenAIRequestContext): Promise<string> {
      return load().then((client) => client.generateText(prompt, context));
    },
    isConfigured(): boolean {
      const { apiKey } = deps.getConfig();
      return Boolean(apiKey);
    },
  };
}
