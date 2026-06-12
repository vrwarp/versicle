/**
 * Composition holder for the GenAIClient singleton (Phase 7 §H). The REAL
 * client (the lazy GeminiClient facade with the useGenAIStore-backed config
 * provider + log sink) is installed by src/app/google/wireGoogle.ts; the
 * fallback is an inline NOT-CONFIGURED client (isConfigured() === false,
 * every call throws GENAI_NOT_CONFIGURED) so stray imports degrade exactly
 * like a missing API key instead of crashing. The fallback deliberately
 * does NOT construct GeminiClient — this holder rides the entry chunk, and
 * a static GeminiClient import here would defeat the Phase 8 §A first-use
 * split (check 4 of scripts/check-worker-chunk.mjs).
 *
 * The E2E mock swap (`window.__versicleTest.genai.setMock`) goes through
 * setGenAIClient too — installTestApi() is DEV/VITE_E2E-gated, so the mock
 * is never reachable from a production graph (boundary rule 9).
 */
import type { GenAIClient } from './contract';
import { GenAINotConfiguredError } from './errors';

const notConfiguredClient: GenAIClient = {
  generateStructured: async () => {
    throw new GenAINotConfiguredError();
  },
  generateText: async () => {
    throw new GenAINotConfiguredError();
  },
  isConfigured: () => false,
};

let instance: GenAIClient | null = null;

export function setGenAIClient(client: GenAIClient): void {
  instance = client;
}

export function getGenAIClient(): GenAIClient {
  // Not memoized: a later wireGoogle/setGenAIClient still wins.
  return instance ?? notConfiguredClient;
}

/** Test-only: drop the singleton so suites can re-wire. */
export function resetGenAIClientForTesting(): void {
  instance = null;
}
