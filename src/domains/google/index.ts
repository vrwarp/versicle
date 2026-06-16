/**
 * domains/google public surface (Phase 7 §G/§H): GoogleAuthClient (per-
 * service tokens, interactive/silent split), DriveClient/DriveLibrarySync,
 * and the GenAI client family. Other domains import THIS module only
 * (boundary rule 3).
 *
 * P9 knip sweep: re-exports with zero consumers were pruned (the barrel
 * carries the CONSUMED surface, not every internal name — re-add a
 * specifier here when a consumer appears). In-domain code and tests import
 * the implementation modules directly.
 */
export { GoogleAuthClient } from './auth/GoogleAuthClient';
export {
  getGoogleAuthClient,
  setGoogleAuthClient,
  defaultPlatformOptions,
} from './auth/holder';
export { GOOGLE_SERVICES, type GoogleServiceId } from './auth/services';
export { GoogleAuthRequiredError } from './auth/errors';
export { DriveClient } from './drive/DriveClient';
export { DriveLibrarySync } from './drive/DriveLibrarySync';
export {
  getDriveClient,
  setDriveClient,
  getDriveLibrarySync,
  setDriveLibrarySync,
  resetDriveHoldersForTesting,
} from './drive/holder';
export type { DriveFile } from './drive/types';

// --- GenAI (Phase 7 §H) ---
// Phase 8 §A (first-use splitting): the GenAI IMPLEMENTATION left this
// index's static value surface. The composition root installs the lazy
// facade (GeminiClient loads on the first generate call) and the feature
// modules load via deep dynamic imports at their lib/genai façade call
// sites — static value re-exports here would drag them back into the
// entry chunk (the feature modules carry module-scope zod schemas that
// defeat tree-shaking; check 4 of scripts/check-worker-chunk.mjs pins the
// emitted artifact).
export { makeLazyGenAIClient } from './genai/lazyClient';
export { MockGenAIClient, type MockGenAIFixture } from './genai/MockGenAIClient';
export { getGenAIClient, setGenAIClient } from './genai/holder';
export { type GenAILogEntry } from './genai/logging';

// --- GenAI embedding (Increment C §1) ---
// Same first-use discipline as the GenAI client: the barrel exports ONLY the
// LAZY facade + holder + contract types (never GeminiEmbeddingClient — check 4
// of scripts/check-worker-chunk.mjs pins the impl out of the entry chunk).
// MockEmbeddingClient is exported for tests only (alongside MockGenAIClient).
export { makeLazyEmbeddingClient } from './genai/embedding/lazyClient';
export { getEmbeddingClient, setEmbeddingClient } from './genai/embedding/holder';
export type {
  EmbeddingClient,
  EmbeddingConfig,
  EmbeddingProfile,
} from './genai/embedding/contract';
export { MockEmbeddingClient } from './genai/embedding/MockEmbeddingClient';
