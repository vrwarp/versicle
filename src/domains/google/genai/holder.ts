/**
 * Composition holder for the GenAIClient singleton (Phase 7 §H). The REAL
 * client (GeminiClient with the useGenAIStore-backed config provider + log
 * sink) is installed by src/app/google/wireGoogle.ts; the lazy fallback is
 * an UNCONFIGURED GeminiClient (isConfigured() === false, every call throws
 * GENAI_NOT_CONFIGURED) so stray imports degrade exactly like a missing API
 * key instead of crashing.
 *
 * The E2E mock swap (`window.__versicleTest.genai.setMock`) goes through
 * setGenAIClient too — installTestApi() is DEV/VITE_E2E-gated, so the mock
 * is never reachable from a production graph (boundary rule 9).
 */
import { GeminiClient } from './GeminiClient';
import type { GenAIClient } from './contract';

let instance: GenAIClient | null = null;

export function setGenAIClient(client: GenAIClient): void {
  instance = client;
}

export function getGenAIClient(): GenAIClient {
  if (!instance) {
    instance = new GeminiClient({
      getConfig: () => ({ apiKey: '', model: 'gemini-flash-lite-latest', rotationEnabled: false }),
    });
  }
  return instance;
}

/** Test-only: drop the singleton so suites can re-wire. */
export function resetGenAIClientForTesting(): void {
  instance = null;
}
