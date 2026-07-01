/**
 * Lazy GenAI client facade (Phase 8 §A first-use splitting): implements the
 * GenAIClient contract over one-time dynamic imports of the provider clients, so
 * the composition root can install the client at boot WITHOUT pulling any
 * provider implementation into the entry chunk — the matching client loads on
 * the first generate call. Check 4 of scripts/check-worker-chunk.mjs asserts
 * GeminiClient / AnthropicClient + the feature modules stay out of the emitted
 * entry closure.
 *
 * The active provider is read PER CALL from `getProvider` (same per-call
 * discipline as config), so switching provider in settings takes effect on the
 * next generate call with no reload. Each provider's client is loaded once and
 * cached by provider key. `isConfigured()` is answered locally from the injected
 * config provider (which already returns the active provider's key) — a
 * synchronous contract method must not wait for a chunk.
 */
import type {
  GenAIClient,
  GenAIProvider,
  GenAIRequest,
  GenAIRequestContext,
} from './contract';
import type { GeminiClientDeps } from './GeminiClient';
import type { AnthropicClientDeps } from './AnthropicClient';

/** Deps shared by both provider clients (structurally identical). */
export type LazyGenAIClientDeps = GeminiClientDeps & AnthropicClientDeps;

export function makeLazyGenAIClient(
  getProvider: () => GenAIProvider,
  deps: LazyGenAIClientDeps,
): GenAIClient {
  const cache = new Map<GenAIProvider, Promise<GenAIClient>>();
  const load = (): Promise<GenAIClient> => {
    const provider = getProvider();
    let clientPromise = cache.get(provider);
    if (!clientPromise) {
      clientPromise =
        provider === 'anthropic'
          ? import('./AnthropicClient').then((m) => new m.AnthropicClient(deps))
          : import('./GeminiClient').then((m) => new m.GeminiClient(deps));
      cache.set(provider, clientPromise);
    }
    return clientPromise;
  };

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
